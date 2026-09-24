/**
 * DMARC — menu du classeur et gestion du déclencheur.
 * Introduit en v1.0.0.
 *
 * Les gestionnaires de menu sont résolus par leur nom global : ils restent des
 * `function` déclarées. Tout le reste du projet est interne (`const nom_`).
 */

function onOpen() {
    try {
        SpreadsheetApp.getUi()
            .createMenu('DMARC')
            .addItem('Traiter les rapports maintenant', 'traiterDepuisMenu')
            .addSeparator()
            .addItem('Activer le traitement horaire', 'installerDeclencheur')
            .addItem('Désactiver le traitement horaire', 'supprimerDeclencheur')
            .addSeparator()
            .addItem('Créer / réinitialiser le tableau de bord', 'creerTableauDeBord')
            .addItem('Configurer le dossier d\'archivage Drive', 'configurerDossierArchive')
            .addItem('Configurer les alertes proactives', 'configurerAlertes')
            .addItem('Archiver et purger les données anciennes', 'purgerDepuisMenu')
            .addItem('Contrôler les enregistrements DNS', 'controlerDnsDepuisMenu')
            .addSeparator()
            .addItem('Aide', 'afficherAide')
            .addItem('À propos', 'aProposDmarc')
            .addToUi();
    } catch (e) {
        console.error(`Erreur à l'ouverture du classeur : ${e}`);
    }
}

function traiterDepuisMenu() {
    const ui = SpreadsheetApp.getUi();
    try {
        if (!verifierCompte_()) {
            ui.alert(`Ce traitement doit être lancé depuis le compte ${CONFIG_DMARC.COMPTE_TECHNIQUE} : `
                + 'c\'est sa boîte Gmail qui reçoit les rapports.');
            return;
        }
        const bilan = traiterRapportsDmarc();
        ui.alert(bilan || 'Un traitement est déjà en cours (déclencheur horaire ou autre fenêtre). '
            + 'Réessayez dans quelques minutes.');
    } catch (e) {
        console.error(`Erreur lors du traitement depuis le menu : ${e}`);
        ui.alert(`Erreur lors du traitement : ${e.message || e}`);
    }
}

function installerDeclencheur() {
    const ui = SpreadsheetApp.getUi();
    try {
        if (!verifierCompte_()) {
            ui.alert(`Le déclencheur doit être installé depuis le compte ${CONFIG_DMARC.COMPTE_TECHNIQUE} : `
                + 'il s\'exécute sous l\'identité de celui qui le pose.');
            return;
        }
        supprimerDeclencheurs_();
        ScriptApp.newTrigger('traiterRapportsDmarc').timeBased().everyHours(1).create();
        ui.alert('Traitement horaire activé.');
    } catch (e) {
        console.error(`Erreur lors de l'installation du déclencheur : ${e}`);
        ui.alert(`Impossible d'activer le traitement horaire : ${e.message || e}`);
    }
}

function supprimerDeclencheur() {
    const ui = SpreadsheetApp.getUi();
    try {
        const nb = supprimerDeclencheurs_();
        ui.alert(nb
            ? 'Traitement horaire désactivé.'
            : 'Aucun déclencheur trouvé pour ce compte. Un déclencheur n\'est visible que '
                + `du compte qui l'a posé : connectez-vous avec ${CONFIG_DMARC.COMPTE_TECHNIQUE}.`);
    } catch (e) {
        console.error(`Erreur lors de la suppression du déclencheur : ${e}`);
        ui.alert(`Impossible de désactiver le traitement horaire : ${e.message || e}`);
    }
}

function configurerDossierArchive() {
    const ui = SpreadsheetApp.getUi();
    try {
        if (!verifierCompte_()) {
            ui.alert(`Cette configuration doit être effectuée depuis le compte ${CONFIG_DMARC.COMPTE_TECHNIQUE}.`);
            return;
        }
        const idActuel = obtenirDossierArchiveId_();
        const reponse = ui.prompt(
            'Archivage Drive des XML bruts',
            `ID actuel du dossier : ${idActuel || '(aucun / désactivé)'}\n\n`
            + 'Entrez l\'ID du dossier Google Drive où archiver les XML (ou laissez vide pour désactiver) :',
            ui.ButtonSet.OK_CANCEL
        );
        if (reponse.getSelectedButton() === ui.Button.OK) {
            const nouvelId = reponse.getResponseText().trim();
            if (nouvelId) {
                let dossier;
                try {
                    dossier = DriveApp.getFolderById(nouvelId);
                } catch (errDrive) {
                    ui.alert(`Impossible d'accéder au dossier Drive avec l'ID "${nouvelId}". `
                        + `Vérifiez l'ID et les droits d'accès du compte technique.\n\nErreur : ${errDrive.message || errDrive}`);
                    return;
                }
                // Un dossier en lecture seule s'ouvre sans erreur, puis chaque
                // createFile échoue et tous les fils passent en erreur.
                // getAccess ne voit pas les droits hérités d'un groupe Google :
                // on prévient et l'on demande, au lieu de refuser à tort.
                if (!droitEcritureDossier_(dossier)) {
                    const suite = ui.alert('Droit d\'écriture non confirmé',
                        `Le compte ${CONFIG_DMARC.COMPTE_TECHNIQUE} ne semble pas pouvoir écrire dans « ${dossier.getName()} ». `
                        + 'Si ce droit lui vient d\'un groupe Google, il est invisible d\'ici et tout ira bien ; '
                        + 'sinon, chaque rapport échouera et tous les fils passeront en erreur.\n\n'
                        + 'Enregistrer ce dossier quand même ?', ui.ButtonSet.OK_CANCEL);
                    if (suite !== ui.Button.OK) return;
                }
                PropertiesService.getScriptProperties().setProperty(CONFIG_DMARC.CLE_DRIVE_FOLDER_ID, nouvelId);
                ui.alert(`Dossier configuré avec succès : « ${dossier.getName()} » (${nouvelId}).`);
            } else {
                PropertiesService.getScriptProperties().deleteProperty(CONFIG_DMARC.CLE_DRIVE_FOLDER_ID);
                ui.alert('Archivage Drive désactivé.');
            }
        }
    } catch (e) {
        console.error(`Erreur lors de la configuration du dossier Drive : ${e}`);
        ui.alert(`Erreur : ${e.message || e}`);
    }
}

/**
 * Le compte courant a-t-il un droit d'écriture DIRECT sur le dossier ?
 * Énumération vérifiée sur la documentation de DriveApp.Permission.
 */
const droitEcritureDossier_ = (dossier) => {
    try {
        const droit = dossier.getAccess(Session.getEffectiveUser());
        return [DriveApp.Permission.OWNER, DriveApp.Permission.EDIT,
            DriveApp.Permission.ORGANIZER, DriveApp.Permission.FILE_ORGANIZER].includes(droit);
    } catch (e) {
        console.error(`Lecture des droits du dossier impossible : ${e}`);
        return false;
    }
};

/** Adresse de courriel plausible — un contrôle de forme, pas une vérification de boîte. */
const COURRIEL_VALIDE_DMARC = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function configurerAlertes() {
    const ui = SpreadsheetApp.getUi();
    try {
        if (!verifierCompte_()) {
            ui.alert(`Cette configuration doit être effectuée depuis le compte ${CONFIG_DMARC.COMPTE_TECHNIQUE}.`);
            return;
        }
        const proprietes = PropertiesService.getScriptProperties();

        const emailActuel = proprietes.getProperty(CONFIG_DMARC.CLE_EMAIL_ALERTE) || CONFIG_DMARC.COMPTE_TECHNIQUE;
        const repEmail = ui.prompt('Alertes DMARC — destinataire',
            `Destinataire actuel : ${emailActuel}\n\n`
            + 'Adresse qui recevra les alertes (laissez vide pour le compte technique) :',
            ui.ButtonSet.OK_CANCEL);
        if (repEmail.getSelectedButton() !== ui.Button.OK) return;
        const nouvelEmail = repEmail.getResponseText().trim();
        if (nouvelEmail && !COURRIEL_VALIDE_DMARC.test(nouvelEmail)) {
            ui.alert(`« ${nouvelEmail} » n'est pas une adresse de courriel. Rien n'a été modifié.`);
            return;
        }

        const webhookActuel = proprietes.getProperty(CONFIG_DMARC.CLE_WEBHOOK_ALERTE) || '';
        const repWebhook = ui.prompt('Alertes DMARC — webhook (facultatif)',
            `Webhook actuel : ${webhookActuel ? 'configuré' : '(aucun)'}\n\n`
            + 'URL HTTPS d\'un webhook Google Chat, Slack ou Discord, ou vide pour n\'en utiliser aucun.\n'
            + 'Cette URL vaut un mot de passe : quiconque la connaît peut écrire dans le salon. '
            + 'Elle est stockée dans les propriétés du script, lisibles par tout éditeur du script.',
            ui.ButtonSet.OK_CANCEL);
        if (repWebhook.getSelectedButton() !== ui.Button.OK) return;
        const nouvelUrl = repWebhook.getResponseText().trim();
        if (nouvelUrl && !WEBHOOK_VALIDE_DMARC.test(nouvelUrl)) {
            ui.alert('Le webhook doit être une URL en https://. Rien n\'a été modifié.');
            return;
        }

        // Les deux réponses sont validées avant d'écrire quoi que ce soit.
        if (nouvelEmail) proprietes.setProperty(CONFIG_DMARC.CLE_EMAIL_ALERTE, nouvelEmail);
        else proprietes.deleteProperty(CONFIG_DMARC.CLE_EMAIL_ALERTE);
        if (nouvelUrl) proprietes.setProperty(CONFIG_DMARC.CLE_WEBHOOK_ALERTE, nouvelUrl);
        else proprietes.deleteProperty(CONFIG_DMARC.CLE_WEBHOOK_ALERTE);

        ui.alert('Alertes configurées.\n\n'
            + `Destinataire : ${nouvelEmail || CONFIG_DMARC.COMPTE_TECHNIQUE}\n`
            + `Webhook : ${nouvelUrl ? 'configuré' : 'aucun'}\n\n`
            + `Les seuils se règlent dans l'onglet « ${CONFIG_DMARC.ONGLET_PARAMETRES} ». `
            + 'Une alerte d\'un type donné ne se répète pas plus d\'une fois par 24 h et par domaine.');
    } catch (e) {
        console.error(`Erreur configuration alertes : ${e}`);
        ui.alert(`Erreur : ${e.message || e}`);
    }
}

function purgerDepuisMenu() {
    const ui = SpreadsheetApp.getUi();
    try {
        if (!verifierCompte_()) {
            ui.alert(`Cette action doit être lancée depuis le compte ${CONFIG_DMARC.COMPTE_TECHNIQUE}.`);
            return;
        }
        const dossier = obtenirDossierArchive_(); // lève si configuré mais inaccessible
        if (!dossier) {
            ui.alert('Purge impossible : aucun dossier d\'archivage Drive n\'est configuré, et rien ne '
                + 'sort du classeur sans copie. Configurez-le d\'abord par DMARC > Configurer le dossier '
                + 'd\'archivage Drive.');
            return;
        }

        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const { valeurs, avertissements } = lireParametres_(ss);
        const jours = valeurs.JOURS_RETENTION;
        const plan = planifierPurge_(ss, jours);
        if (!plan.rapArchives.length) {
            ui.alert(`Aucun rapport terminé depuis plus de ${jours} jours : rien à purger.`);
            return;
        }

        // Plan puis application : les chiffres exacts avant de confirmer.
        const reponse = ui.alert('Archiver et purger les données anciennes ?', [
            `Rapports terminés depuis plus de ${jours} jours : ${plan.rapArchives.length}`,
            `Enregistrements correspondants : ${plan.enrArchives.length}`,
            '',
            `Ils seront d'abord archivés en deux fichiers CSV dans le dossier « ${dossier.getName()} », `
                + 'puis retirés du classeur. Cette suppression ne se défait pas depuis le classeur ; '
                + 'seuls les CSV permettent de retrouver les données.',
            ...(avertissements.length ? ['', ...avertissements] : []),
            '',
            `Durée réglable dans l'onglet « ${CONFIG_DMARC.ONGLET_PARAMETRES} » (JOURS_RETENTION).`
        ].join('\n'), ui.ButtonSet.OK_CANCEL);
        if (reponse !== ui.Button.OK) return;

        const resultat = archiverEtPurgerAnciennesLignes_(ss, jours);
        const ecart = resultat.rapportsPurges !== plan.rapArchives.length
            ? ['', 'Les chiffres diffèrent de l\'annonce : des rapports ont été traités entre-temps.'] : [];
        // Une opération irréversible laisse une trace datée, lisible de tous.
        journaliser_(ss, `purge par ${Session.getEffectiveUser().getEmail()}`,
            `Purge (> ${jours} jours) : ${resultat.rapportsPurges} rapports, ${resultat.enregPurges} `
            + `enregistrements. Archives : ${resultat.fichiers.join(', ')}.`);
        ui.alert('Purge terminée', [
            `Rapports purgés : ${resultat.rapportsPurges}`,
            `Enregistrements purgés : ${resultat.enregPurges}`,
            `Archives créées dans « ${dossier.getName()} » :`,
            ...resultat.fichiers.map(f => `  - ${f}`),
            ...ecart
        ].join('\n'), ui.ButtonSet.OK);
    } catch (e) {
        console.error(`Erreur purge : ${e}`);
        ui.alert(`Purge interrompue : ${e.message || e}`);
    }
}

function aProposDmarc() {
    try {
        const ui = SpreadsheetApp.getUi();
        ui.alert(`${PRODUIT_DMARC.NOM} — v${VERSION_DMARC}`, [
            'Lit les rapports DMARC agrégés reçus par le compte technique, les range dans les '
                + `onglets « ${CONFIG_DMARC.ONGLET_RAPPORTS} » et « ${CONFIG_DMARC.ONGLET_ENREG} », `
                + 'puis met le fil à la corbeille.',
            '',
            `Un fil que le script ne sait pas lire reçoit le libellé « ${CONFIG_DMARC.ERROR_LABEL} » `
                + 'et n\'est plus retraité : examinez-le, puis retirez le libellé pour le relancer.',
            '',
            `Seuils d'alerte et durée de rétention : onglet « ${CONFIG_DMARC.ONGLET_PARAMETRES} », `
                + 'chaque ligne explique son effet.',
            '',
            `Débutant avec SPF, DKIM et DMARC ? Menu DMARC > Aide, ou l'onglet « ${CONFIG_DMARC.ONGLET_AIDE} ».`,
            '',
            'Taux de conformité : part des messages dont DKIM ou SPF passe ET est aligné sur le '
                + 'domaine de l\'en-tête From — c\'est la définition même de DMARC.',
            '',
            `${PRODUIT_DMARC.AUTEUR} — ${PRODUIT_DMARC.SITE}`
        ].join('\n'), ui.ButtonSet.OK);
    } catch (e) {
        console.error(`Erreur À propos : ${e}`);
    }
}
