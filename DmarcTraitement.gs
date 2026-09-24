/**
 * DMARC — traitement des fils Gmail.
 * Introduit en v1.0.0.
 *
 * IMPORTANT : le script lit la boîte Gmail de l'utilisateur qui l'exécute.
 * Le déclencheur doit donc être installé depuis le compte technique.
 */

/** Libellé Gmail, créé au besoin. */
const libelle_ = nom => GmailApp.getUserLabelByName(nom) || GmailApp.createLabel(nom);

/**
 * Point d'entrée, appelé par le déclencheur horaire (qui passe un événement)
 * ou par le menu (sans argument).
 */
function traiterRapportsDmarc(e) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const origine = origineAppel_(e);
    if (!verifierCompte_()) {
        const refus = `Exécution refusée : compte ${Session.getEffectiveUser().getEmail()}`;
        console.error(refus);
        journaliser_(ss, origine, refus);
        return 'Compte non autorisé.';
    }

    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(1000)) {
        // Avant la v1.3.0, ce retour était muet : un passage sauté ne se voyait nulle part.
        journaliser_(ss, origine, 'Passage sauté : un autre traitement ou une purge tient le verrou.');
        return null;
    }

    try {
        const debut = Date.now();
        const shRapports = feuille_(ss, CONFIG_DMARC.ONGLET_RAPPORTS, ENTETES_RAPPORTS);
        // Lu avant de toucher à quoi que ce soit : lève si l'onglet est cassé.
        const { domaines, adresses: adressesRua, avertissements: avertDomaines } = lireOngletDomaines_(ss);
        if (!adressesRua.length) {
            // Sans adresse, on ne relève rien : chercher sans filtre ferait
            // traiter tout ce que reçoit le compte technique.
            const bilanVide = [
                `Aucune adresse de réception valide dans la colonne « adresse_rua » de l'onglet `
                    + `« ${CONFIG_DMARC.ONGLET_DOMAINES} » : aucun rapport n'a été relevé.`,
                'Renseignez au moins une adresse — celle de l\'enregistrement DNS rua=mailto:… de vos domaines.',
                ...avertDomaines
            ].join('\n');
            journaliser_(ss, origine, bilanVide);
            return bilanVide;
        }
        feuille_(ss, CONFIG_DMARC.ONGLET_ENREG, ENTETES_ENREG);
        // Avant toute lecture de clé : les onglets d'une version antérieure
        // reçoivent leur colonne cle (une seule fois, sous le verrou).
        const migration = migrerCleRapports_(ss);
        const migrationDkim = migrerDiagnosticDkim_(ss);
        const contexte = {
            shRapports,
            shEnreg: ss.getSheetByName(CONFIG_DMARC.ONGLET_ENREG),
            idsConnus: idsExistants_(shRapports),
            dossier: obtenirDossierArchive_(),
            domaines,
            labelErreur: libelle_(CONFIG_DMARC.ERROR_LABEL),
            labelHorsListe: libelle_(CONFIG_DMARC.LABEL_HORS_LISTE)
        };
        const totaux = { ok: 0, erreur: 0, doublons: 0, rapports: 0, horsListe: 0, filsHorsListe: 0,
            domainesHorsListe: new Set() };

        const adresses = adressesRua.map(a => `deliveredto:${a}`).join(' OR ');
        const requete = `{${adresses}} -in:trash -label:${CONFIG_DMARC.ERROR_LABEL} `
            + `-label:${CONFIG_DMARC.LABEL_HORS_LISTE}`;

        // On enchaîne les pages tant qu'il reste du temps : chaque fil traité
        // part à la corbeille ou reçoit le libellé d'erreur, donc sort de la
        // recherche, et la page suivante se relit toujours depuis 0. Autrefois
        // plafonné à 50 fils par heure, un pic de rapports (plusieurs domaines,
        // reprise après panne) creusait un retard qui ne se résorbait jamais.
        // `vus` protège d'un index de recherche en retard sur la corbeille :
        // une page sans fil nouveau arrête la boucle au lieu de tourner à vide.
        const vus = new Set();
        let interrompu = false;
        let pagePleine = true;
        while (pagePleine && !interrompu) {
            const threads = GmailApp.search(requete, 0, CONFIG_DMARC.MAX_THREADS);
            pagePleine = threads.length === CONFIG_DMARC.MAX_THREADS;
            const nouveaux = threads.filter(t => !vus.has(t.getId()));
            if (!nouveaux.length) break;

            const resultatsLot = [];
            for (const thread of nouveaux) {
                if (Date.now() - debut > CONFIG_DMARC.MAX_RUNTIME_MS) { interrompu = true; break; }
                vus.add(thread.getId());
                resultatsLot.push(traiterFil_(thread, contexte, totaux));
            }

            // Écriture groupée (batching) pour l'ensemble du lot :
            // évite de multiplier les setValues() et flush() réseau par fil.
            // Les fils en échec y figurent aussi : leurs rapports lisibles sont
            // écrits, seul le fil reste en attente sous le libellé d'erreur.
            const lotRapports = resultatsLot.flatMap(r => r.lignesRapports);
            const lotEnreg = resultatsLot.flatMap(r => r.lignesEnreg);
            ajouterLignes_(contexte.shRapports, lotRapports);
            ajouterLignes_(contexte.shEnreg, lotEnreg);
            SpreadsheetApp.flush();
            totaux.rapports += lotRapports.length;

            // Corbeille et libellé APRÈS l'écriture : une interruption entre les
            // deux fait au pire relire un fil, dont les rapports seront alors
            // reconnus comme doublons.
            //
            // À la corbeille vont les messages LUS, pas le fil : un rapport
            // arrivé dans le même fil entre la lecture et ce point (émetteur à
            // objet constant) partait sinon à la corbeille sans avoir été lu.
            resultatsLot.forEach(({ thread, succes, horsListe, messagesLus }) => {
                if (!succes) { thread.addLabel(contexte.labelErreur); totaux.erreur++; }
                else if (horsListe) { thread.addLabel(contexte.labelHorsListe); totaux.filsHorsListe++; }
                else { messagesLus.forEach(m => m.moveToTrash()); totaux.ok++; }
            });
        }

        ajusterTableauDeBord_(ss);

        // Étapes annexes : sautées si le budget de temps est déjà consommé, pour
        // ne pas dépasser le plafond de 6 minutes. Elles reprennent au passage
        // suivant. Une panne de l'une n'empêche ni l'autre ni le bilan.
        const annexes = [];
        if (interrompu) {
            annexes.push('Noms d\'hôte et alertes reportés au prochain passage (budget de temps).');
        } else {
            try {
                mettreAJourAideSiNecessaire_(ss);
            } catch (e) {
                console.error(`Erreur de mise à jour de l'aide : ${e}`);
            }
            try {
                enrichirTopSourcesNonConformes_(ss);
            } catch (e) {
                console.error(`Erreur de résolution des noms d'hôte : ${e}`);
            }
            let parametres = null;
            try {
                const lus = lireParametres_(ss);
                parametres = lus.valeurs;
                annexes.push(...lus.avertissements);
            } catch (e) {
                console.error(`Paramètres illisibles : ${e}`);
                annexes.push(`Paramètres illisibles, alertes non vérifiées : ${e.message || e}`);
            }
            const tdb = ss.getSheetByName(TABLEAU_DMARC.FEUILLE);
            if (parametres && tdb) {
                try {
                    const ramene = alignerFiltrePeriode_(tdb, parametres);
                    if (ramene) {
                        annexes.push(`Filtre Période du tableau de bord ramené à ${ramene} jours : `
                            + `la durée de conservation (JOURS_RETENTION = ${parametres.JOURS_RETENTION}) `
                            + 'ne permet pas plus.');
                    }
                } catch (e) {
                    console.error(`Alignement du filtre Période : ${e}`);
                }
            }
            if (parametres) {
                try {
                    const alerte = envoyerAlertesSiNecessaire_(ss, parametres, domaines);
                    if (alerte && alerte.canaux.length) {
                        annexes.push(`Alerte envoyée pour ${alerte.domaines.join(', ')} (${alerte.canaux.join(', ')}).`);
                    }
                    if (alerte && alerte.echecs.length) {
                        annexes.push(`Alerte NON transmise — ${alerte.echecs.join(' ; ')}.`
                            + (alerte.canaux.length ? '' : ' Elle sera retentée au prochain passage.'));
                    }
                } catch (e) {
                    console.error(`Erreur de détection des anomalies : ${e}`);
                    annexes.push(`Détection des anomalies en échec : ${e.message || e}`);
                }
            }
        }

        const lignes = [
            `Fils traités : ${totaux.ok}`,
            `Fils en erreur (libellé ${CONFIG_DMARC.ERROR_LABEL}) : ${totaux.erreur}`,
            `Nouveaux rapports : ${totaux.rapports}`,
            `Doublons ignorés : ${totaux.doublons}`
        ];
        if (interrompu) {
            lignes.push('Budget de temps atteint : les fils restants seront traités au prochain passage.');
        }
        lignes.push(contexte.dossier
            ? `Archivage Drive : actif (dossier « ${contexte.dossier.getName()} »).`
            : 'Archivage Drive : DÉSACTIVÉ — les XML bruts ne sont conservés que 30 jours, '
                + 'dans la corbeille. Pour les garder : DMARC > Configurer le dossier d\'archivage Drive.');
        if (migration.rapports || migration.enregistrements) {
            lignes.push(`Migration v1.6.0 : clé émetteur|identifiant ajoutée à ${migration.rapports} rapports `
                + `et ${migration.enregistrements} enregistrements.`
                + (migration.nonRattaches
                    ? ` ${migration.nonRattaches} enregistrement(s) sans rapport unique : clé laissée vide, `
                        + 'ils n\'apparaissent plus dans le tableau de bord.'
                    : ''));
        }
        if (migrationDkim) {
            lignes.push(`Migration v1.7.0 : diagnostic DKIM calculé pour ${migrationDkim} enregistrements.`);
        }
        lignes.push(...avertDomaines);
        if (!domaines.size) {
            lignes.push(`Filtrage des domaines DÉSACTIVÉ : l'onglet « ${CONFIG_DMARC.ONGLET_DOMAINES} » est vide, `
                + 'tout rapport est accepté, quel que soit son domaine.');
        }
        if (totaux.horsListe) {
            lignes.push(`Rapports hors liste, non enregistrés : ${totaux.horsListe} `
                + `(domaines : ${[...totaux.domainesHorsListe].sort().join(', ')}). `
                + `${totaux.filsHorsListe} fil(s) conservé(s) sous le libellé « ${CONFIG_DMARC.LABEL_HORS_LISTE} ». `
                + `Domaine légitime ? Ajoutez-le à l'onglet « ${CONFIG_DMARC.ONGLET_DOMAINES} », puis retirez le libellé.`);
        }
        lignes.push(...annexes);
        if (totaux.erreur) {
            lignes.push(`Examinez les fils « ${CONFIG_DMARC.ERROR_LABEL} » dans Gmail, `
                + 'puis retirez le libellé pour les relancer.');
        }
        const bilan = lignes.join('\n');
        console.log(bilan.replace(/\n/g, ' | '));
        journaliser_(ss, origine, bilan);
        return bilan;
    } catch (erreur) {
        journaliser_(ss, origine, `ÉCHEC : ${erreur.message || erreur}`);
        throw erreur;
    } finally {
        verrou.releaseLock();
    }
}

/**
 * Traite un fil : extrait et archive ses rapports.
 *
 * Renvoie toujours les lignes des rapports lisibles, même si une autre pièce
 * du fil a échoué : `succes` décide seulement du sort du fil (corbeille ou
 * libellé d'erreur). Retenir ces lignes jusqu'à la réussite complète du fil
 * les perdait pour de bon quand la pièce fautive était durablement illisible
 * (rapport forensique, notification) : chaque relance échouait de même, et
 * seule l'archive Drive se dupliquait à chaque passage.
 *
 * Un rapport pour un domaine hors de l'onglet Domaines n'est ni archivé ni
 * enregistré ; `horsListe` fait conserver le fil sous son propre libellé.
 */
const traiterFil_ = (thread, { idsConnus, dossier, domaines }, totaux) => {
    const lignesRapports = [];
    const lignesEnreg = [];
    const messagesLus = [];
    let succes = true;
    let horsListe = false;
    let nbXml = 0;

    // La documentation ne dit pas si getMessages() rend les messages déjà à la
    // corbeille : on les écarte nous-mêmes.
    for (const message of thread.getMessages().filter(m => !m.isInTrash())) {
        messagesLus.push(message);
        for (const pj of message.getAttachments()) {
            try {
                for (const xmlBlob of extraireXml_(pj)) {
                    const xmlTexte = xmlBlob.getDataAsString('UTF-8');
                    const { rapport, enregistrements } = parserRapport_(xmlTexte);
                    nbXml++;

                    const reportId = rapport[0];
                    const domaine = rapport[5];
                    const cle = cleRapport_(rapport[1], reportId);
                    if (domaines.size && !domaineSurveille_(domaine, domaines)) {
                        horsListe = true;
                        totaux.horsListe++;
                        totaux.domainesHorsListe.add(String(domaine || '(vide)').toLowerCase());
                        continue;
                    }
                    if (idsConnus.has(cle)) { totaux.doublons++; continue; }

                    const nomFichier = xmlBlob.getName() || `${reportId}.xml`;
                    // L'archive passe AVANT l'enregistrement de l'identifiant :
                    // si Drive échoue, le rapport n'est pas marqué connu, et la
                    // relance du fil l'écrira. Dans l'ordre inverse, la relance le
                    // prenait pour un doublon et l'XML brut n'était jamais archivé.
                    if (dossier) {
                        dossier.createFile(Utilities.newBlob(xmlTexte, 'application/xml', nomFichier));
                    }
                    // Marqué connu dès maintenant : ses lignes partent avec le lot
                    // quelle que soit l'issue du fil, et un second exemplaire du
                    // même rapport (dans ce fil ou un autre du lot) est un doublon.
                    idsConnus.add(cle);

                    lignesRapports.push([...rapport, nomFichier, new Date(), cle]);
                    const detailleDkim = enregistrements.some(e => String(e[7] || '').trim());
                    enregistrements.forEach(e => lignesEnreg.push([reportId, domaine, ...e, cle,
                        diagnosticDkim_(e[5], e[7], e[8], detailleDkim)]));
                }
            } catch (e) {
                succes = false;
                console.error(`Erreur sur "${pj.getName()}" (${message.getSubject()}) : ${e}`);
            }
        }
    }

    // Aucun rapport trouvé (notification, rapport forensic…) : à vérifier
    if (nbXml === 0) succes = false;

    return { thread, succes, horsListe, messagesLus, lignesRapports, lignesEnreg };
};
