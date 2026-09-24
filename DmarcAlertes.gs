/**
 * DMARC — détection des anomalies et alertes proactives.
 * Introduit en v1.2.0.
 *
 * La fenêtre porte sur la date de RÉCEPTION des rapports (`traite_le`), pas sur
 * la période qu'ils couvrent : un rapport arrive après sa période — Google
 * envoie aujourd'hui celui d'hier, commencé hier à 0 h UTC. Filtrer sur
 * `date_debut` écartait presque tout, et l'alerte ne partait jamais.
 */

const UN_JOUR_MS_DMARC = 24 * 60 * 60 * 1000;

/** Lignes relues d'un coup en remontant l'onglet Enregistrements. */
const BLOC_LECTURE_ALERTES = 2000;

const MOIS_DMARC = Object.freeze(['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
    'août', 'septembre', 'octobre', 'novembre', 'décembre']);

/**
 * « 6 septembre 2026 » : la date telle qu'un lecteur la lit.
 * Le stockage reste en `Date` ; la conversion appartient à la présentation.
 * Apps Script règle l'horloge JavaScript sur le fuseau du projet.
 */
const dateLisible_ = d => `${d.getDate()} ${MOIS_DMARC[d.getMonth()]} ${d.getFullYear()}`;

/**
 * Relit l'onglet Rapports une fois pour toutes les détections : report_id,
 * domaine, période couverte et date de réception de chaque rapport.
 */
const lireRapports_ = (shRapports) => {
    const n = shRapports.getLastRow() - 1;
    if (n < 1) return [];
    const col = nom => ENTETES_RAPPORTS.indexOf(nom);
    const [cId, cOrg, cDom, cDeb, cFin, cTraite] = ['report_id', 'org_name', 'domaine', 'date_debut', 'date_fin',
        'traite_le'].map(col);
    return shRapports.getRange(2, 1, n, ENTETES_RAPPORTS.length).getValues().map(r => ({
        id: cleRapport_(r[cOrg], r[cId]),
        domaine: String(r[cDom] || '').trim().toLowerCase(),
        debut: estDate_(r[cDeb]) ? r[cDeb] : null,
        fin: estDate_(r[cFin]) ? r[cFin] : null,
        traite: estDate_(r[cTraite]) ? r[cTraite] : null
    }));
};

/**
 * Domaines surveillés dont aucun rapport n'a été reçu depuis
 * `JOURS_SANS_RAPPORT_ALERTE` jours. Un enregistrement DNS supprimé ou un
 * alias cassé ne produit aucun rapport, donc aucune autre alerte : c'est la
 * panne la plus probable, et la seule qui se tait.
 * Sans liste de domaines, on surveille le silence de l'ensemble (« tous »).
 */
const domainesMuets_ = (rapports, domaines, parametres, maintenant) => {
    const limite = maintenant - parametres.JOURS_SANS_RAPPORT_ALERTE * UN_JOUR_MS_DMARC;
    const recus = rapports.filter(r => r.traite);
    // Même règle que le filtre d'entrée : un rapport de sous-domaine compte
    // pour le domaine listé.
    const dernierPour = (d) => {
        const concernes = d === 'tous' ? recus : recus.filter(r => domaineSurveille_(r.domaine, new Set([d])));
        return concernes.reduce((max, r) => (!max || r.traite > max ? r.traite : max), null);
    };
    const aSurveiller = domaines.size ? [...domaines] : ['tous'];
    return aSurveiller
        .map(d => ({ domaine: d, type: 'SILENCE', dernier: dernierPour(d), sources: [] }))
        .filter(a => !a.dernier || a.dernier.getTime() < limite);
};

/**
 * Enregistrements des rapports récents, lus en remontant depuis le bas.
 *
 * Les lignes sont ajoutées dans l'ordre de réception, et la purge conserve
 * cet ordre : les récentes sont groupées en fin d'onglet. On lit donc par blocs
 * depuis le bas et l'on s'arrête au premier bloc qui n'en contient plus, au
 * lieu de relire chaque heure un onglet de centaines de milliers de lignes.
 */
const enregistrementsRecents_ = (shEnreg, idsRecents) => {
    const lignes = [];
    let fin = shEnreg.getLastRow();
    while (fin >= 2) {
        const debut = Math.max(2, fin - BLOC_LECTURE_ALERTES + 1);
        const colCle = ENTETES_ENREG.indexOf('cle');
        const bloc = shEnreg.getRange(debut, 1, fin - debut + 1, ENTETES_ENREG.length).getValues()
            .filter(r => idsRecents.has(String(r[colCle])));
        if (!bloc.length) break;
        lignes.push(...bloc);
        fin = debut - 1;
    }
    return lignes;
};

/**
 * Anomalies des 24 dernières heures de réception, par domaine.
 * `maintenant` est injectable pour le banc d'essai.
 */
const detecterAnomalies_ = (ss, parametres, domaines = new Set(), maintenant = Date.now()) => {
    const shEnreg = ss.getSheetByName(CONFIG_DMARC.ONGLET_ENREG);
    const shRapports = ss.getSheetByName(CONFIG_DMARC.ONGLET_RAPPORTS);
    if (!shEnreg || !shRapports) return [];

    const rapports = lireRapports_(shRapports);
    const muets = domainesMuets_(rapports, domaines, parametres, maintenant);

    const depuis = maintenant - UN_JOUR_MS_DMARC;
    const recents = rapports.filter(r => r.traite && r.traite.getTime() >= depuis);
    const idsRecents = new Set(recents.map(r => r.id));
    if (!idsRecents.size || shEnreg.getLastRow() < 2) return muets;

    // Période couverte par les rapports reçus, par domaine : après une panne,
    // un arriéré traité d'un coup est « reçu en 24 h » mais peut décrire un
    // incident vieux de plusieurs jours. L'alerte le dit.
    const periodes = new Map();
    recents.forEach(({ domaine, debut, fin }) => {
        const p = periodes.get(domaine) || { debut: null, fin: null };
        if (debut && (!p.debut || debut < p.debut)) p.debut = debut;
        if (fin && (!p.fin || fin > p.fin)) p.fin = fin;
        periodes.set(domaine, p);
    });

    const agregats = new Map();
    enregistrementsRecents_(shEnreg, idsRecents)
        .forEach(([, domaine, sourceIp, count, disposition, dkim, spf]) => {
            const dom = String(domaine || '').toLowerCase();
            if (!dom) return;
            if (!agregats.has(dom)) {
                agregats.set(dom, { total: 0, conforme: 0, rejetes: 0, sourcesNonConformes: new Map() });
            }
            const stats = agregats.get(dom);
            const cnt = Number(count) || 0;
            stats.total += cnt;

            // Même définition que le tableau de bord : DKIM ou SPF aligné.
            if (String(dkim) === 'pass' || String(spf) === 'pass') {
                stats.conforme += cnt;
            } else {
                const ip = String(sourceIp || 'inconnue');
                stats.sourcesNonConformes.set(ip, (stats.sourcesNonConformes.get(ip) || 0) + cnt);
                if (String(disposition) === 'reject') stats.rejetes += cnt;
            }
        });

    const principales = stats => [...stats.sourcesNonConformes.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 5);

    const anomalies = [...muets];
    agregats.forEach((stats, domaine) => {
        const taux = stats.total ? stats.conforme / stats.total : 1;
        const periode = periodes.get(domaine) || { debut: null, fin: null };
        if (stats.total >= parametres.VOLUME_MIN_ALERTE && taux < parametres.SEUIL_ALERTE_CONFORMITE) {
            anomalies.push({ domaine, type: 'CONFORMITE_BASSE', taux, total: stats.total,
                conforme: stats.conforme, sources: principales(stats), periode });
        }
        if (stats.rejetes >= parametres.SEUIL_ALERTE_REJETS) {
            anomalies.push({ domaine, type: 'PIC_REJETS', rejetes: stats.rejetes, total: stats.total,
                sources: principales(stats), periode });
        }
    });
    return anomalies;
};

const cleAlerte_ = (domaine, type) => `ALERTE_${type}_${domaine.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

/** Vrai si une alerte de ce type pour ce domaine est PARTIE il y a moins de 24 heures. */
const alerteEnCooldown_ = (domaine, type, maintenant = Date.now()) => {
    const derniere = Number(PropertiesService.getScriptProperties().getProperty(cleAlerte_(domaine, type)));
    return Number.isFinite(derniere) && derniere > 0 && maintenant - derniere < UN_JOUR_MS_DMARC;
};

/** Adresse de webhook acceptable : HTTPS seulement, sans espace. */
const WEBHOOK_VALIDE_DMARC = /^https:\/\/[^\s/]+\/\S*$/i;

/**
 * Corps JSON attendu par le service du webhook.
 * Discord lit `content` (2 000 caractères au plus) ; Google Chat et Slack lisent `text`.
 */
const corpsWebhook_ = (url, texte) => (/^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\//i.test(url)
    ? { content: texte.length > 2000 ? `${texte.slice(0, 1990)}\n[…]` : texte }
    : { text: texte });

/**
 * Construit et expédie les alertes des anomalies hors délai de 24 h.
 *
 * Rend `{ domaines, canaux, echecs }`, ou null s'il n'y avait rien à envoyer.
 * Le délai n'est enregistré que si au moins un canal a effectivement porté
 * l'alerte : marquer un envoi raté la faisait disparaître pour 24 h sans trace.
 */
const envoyerAlertesSiNecessaire_ = (ss, parametres, domainesSurveilles = new Set(), maintenant = Date.now()) => {
    const aNotifier = detecterAnomalies_(ss, parametres, domainesSurveilles, maintenant)
        .filter(a => !alerteEnCooldown_(a.domaine, a.type, maintenant));
    if (!aNotifier.length) return null;

    const proprietes = PropertiesService.getScriptProperties();
    const destinataire = proprietes.getProperty(CONFIG_DMARC.CLE_EMAIL_ALERTE) || CONFIG_DMARC.COMPTE_TECHNIQUE;
    const webhookUrl = proprietes.getProperty(CONFIG_DMARC.CLE_WEBHOOK_ALERTE) || '';

    const lignes = ['Alerte DMARC', ''];
    aNotifier.forEach((a) => {
        if (a.type === 'SILENCE') {
            const quoi = a.domaine === 'tous' ? 'Aucun domaine' : a.domaine;
            lignes.push(`🔕 ${quoi} — aucun rapport reçu depuis ${parametres.JOURS_SANS_RAPPORT_ALERTE} jours `
                + (a.dernier ? `(dernier reçu le ${dateLisible_(a.dernier)}).` : '(aucun jamais reçu).'));
            lignes.push('   Vérifiez l\'enregistrement DNS _dmarc (rua=) et l\'acheminement de l\'adresse '
                + 'de réception jusqu\'au compte technique.');
            lignes.push('');
            return;
        }
        if (a.periode && a.periode.debut && a.periode.fin) {
            lignes.push(`Rapports reçus ces dernières 24 heures, couvrant du ${dateLisible_(a.periode.debut)} `
                + `au ${dateLisible_(a.periode.fin)} :`);
        }
        if (a.type === 'CONFORMITE_BASSE') {
            lignes.push(`⚠️ ${a.domaine} — conformité ${(a.taux * 100).toFixed(1)} % `
                + `(seuil ${(parametres.SEUIL_ALERTE_CONFORMITE * 100).toFixed(1)} %) : `
                + `${a.conforme} messages conformes sur ${a.total}.`);
        } else {
            // « Rejet » et non « usurpation » : un message rejeté peut aussi être
            // un transfert ou une liste de diffusion légitime.
            lignes.push(`🚨 ${a.domaine} — pic de rejets : ${a.rejetes} messages non conformes rejetés `
                + `par les destinataires (seuil ${parametres.SEUIL_ALERTE_REJETS}), sur ${a.total}.`);
        }
        if (a.sources.length) {
            lignes.push('   Principales sources non conformes :');
            a.sources.forEach(([ip, vol]) => lignes.push(`     - ${ip} : ${vol} messages`));
        }
        lignes.push('');
    });
    lignes.push('Les seuils se règlent dans l\'onglet « Paramètres » du classeur ; '
        + 'le tableau de bord détaille chaque source.');
    lignes.push('', `— Rapports DMARC v${VERSION_DMARC}`);
    const corps = lignes.join('\n');
    const domaines = [...new Set(aNotifier.map(a => a.domaine))];
    const sujet = `[DMARC] Anomalie sur ${domaines.join(', ')}`;

    const canaux = [];
    const echecs = [];
    try {
        MailApp.sendEmail({ to: destinataire, subject: sujet, body: corps });
        canaux.push(`courriel à ${destinataire}`);
    } catch (e) {
        echecs.push(`courriel à ${destinataire} : ${e.message || e}`);
    }

    if (webhookUrl) {
        if (!WEBHOOK_VALIDE_DMARC.test(webhookUrl)) {
            echecs.push('webhook : adresse refusée (HTTPS obligatoire) — reconfigurez les alertes');
        } else {
            try {
                const reponse = UrlFetchApp.fetch(webhookUrl, {
                    method: 'post',
                    contentType: 'application/json',
                    payload: JSON.stringify(corpsWebhook_(webhookUrl, corps)),
                    muteHttpExceptions: true
                });
                const code = reponse.getResponseCode();
                if (code >= 200 && code < 300) canaux.push('webhook');
                else echecs.push(`webhook : réponse HTTP ${code}`);
            } catch (e) {
                echecs.push(`webhook : ${e.message || e}`);
            }
        }
    }
    echecs.forEach(e => console.error(`Alerte DMARC non transmise — ${e}`));

    if (canaux.length) {
        aNotifier.forEach(a => proprietes.setProperty(cleAlerte_(a.domaine, a.type), String(maintenant)));
    }
    return { domaines, canaux, echecs };
};
