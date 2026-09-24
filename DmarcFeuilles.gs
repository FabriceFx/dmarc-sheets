/**
 * DMARC — utilitaires : compte, déclencheurs, onglets.
 * Introduit en v1.0.0.
 */

/** Vérifie que le script tourne bien sous le compte technique. */
const verifierCompte_ = () => {
    const email = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
    return email === CONFIG_DMARC.COMPTE_TECHNIQUE.toLowerCase();
};

/** Supprime les déclencheurs du traitement pour l'utilisateur courant. */
const supprimerDeclencheurs_ = () => {
    const declencheurs = ScriptApp.getProjectTriggers()
        .filter(t => t.getHandlerFunction() === 'traiterRapportsDmarc');
    declencheurs.forEach(t => ScriptApp.deleteTrigger(t));
    return declencheurs.length;
};

/**
 * Récupère le dossier Drive d'archivage, ou null si l'archivage est désactivé.
 *
 * Configuré mais inaccessible, il LÈVE au lieu de rendre null : continuer
 * mettrait les fils à la corbeille sans archiver leur XML, qui disparaîtrait
 * 30 jours plus tard — l'inverse exact de ce que la configuration demande.
 * Rien n'est touché tant que le dossier n'est pas rétabli.
 */
const obtenirDossierArchive_ = () => {
    const id = obtenirDossierArchiveId_();
    if (!id) return null;
    try {
        return DriveApp.getFolderById(id);
    } catch (e) {
        console.error(`Dossier d'archivage Drive inaccessible (ID : "${id}") : ${e}`);
        throw new Error(`Le dossier d'archivage Drive (ID « ${id} ») est introuvable ou inaccessible `
            + `au compte ${CONFIG_DMARC.COMPTE_TECHNIQUE}. Aucun fil n'a été traité. `
            + 'Corrigez l\'ID par DMARC > Configurer le dossier d\'archivage Drive, '
            + 'ou videz-le pour désactiver l\'archivage.');
    }
};

/**
 * Vrai pour un objet `Date` valide.
 *
 * Pas d'`instanceof Date` : il échoue sur un objet venu d'un autre contexte
 * d'exécution (le banc d'essai en est un), et une `Invalid Date` le passe.
 */
const estDate_ = v => Object.prototype.toString.call(v) === '[object Date]' && !Number.isNaN(v.getTime());

/** Récupère ou crée un onglet avec sa ligne d'en-têtes. */
const feuille_ = (ss, nom, entetes) => {
    let sh = ss.getSheetByName(nom);
    if (!sh) {
        sh = ss.insertSheet(nom);
        sh.getRange(1, 1, 1, entetes.length).setValues([entetes]).setFontWeight('bold');
        sh.setFrozenRows(1);
    }
    return sh;
};

/**
 * Clé d'un rapport : émetteur (sans casse) + report_id.
 * Le « | » ne figure ni dans un report_id ni, en pratique, dans un org_name.
 */
const cleRapport_ = (org, id) => `${String(org || '').trim().toLowerCase()}|${String(id || '').trim()}`;

/**
 * Clés des rapports déjà enregistrés, pour écarter les doublons.
 * Recalculées depuis report_id et org_name plutôt que lues dans la colonne
 * cle : elles restent justes même sur une ligne que la migration n'a pas
 * encore atteinte.
 */
const idsExistants_ = (sh) => {
    const n = sh.getLastRow() - 1;
    if (n < 1) return new Set();
    const cId = ENTETES_RAPPORTS.indexOf('report_id');
    const cOrg = ENTETES_RAPPORTS.indexOf('org_name');
    return new Set(sh.getRange(2, 1, n, Math.max(cId, cOrg) + 1).getValues()
        .map(r => cleRapport_(r[cOrg], r[cId])));
};

/**
 * Migration v1.6.0 : ajoute et remplit la colonne cle des onglets Rapports et
 * Enregistrements créés par une version antérieure.
 *
 * Les valeurs d'abord, l'en-tête ensuite : c'est l'en-tête qui marque la
 * migration comme faite, si bien qu'une interruption la fait recommencer au
 * lieu de la laisser à moitié. Un enregistrement dont le report_id ne désigne
 * pas un seul rapport (orphelin, ou deux émetteurs pour un même id) n'est pas
 * deviné : sa clé reste vide et il est compté.
 *
 * Rend { rapports, enregistrements, nonRattaches } : lignes migrées par onglet.
 */
const migrerCleRapports_ = (ss) => {
    const resultat = { rapports: 0, enregistrements: 0, nonRattaches: 0 };
    const rap = ss.getSheetByName(CONFIG_DMARC.ONGLET_RAPPORTS);
    const enr = ss.getSheetByName(CONFIG_DMARC.ONGLET_ENREG);
    if (!rap || !enr) return resultat;

    const colR = ENTETES_RAPPORTS.indexOf('cle') + 1;
    const colE = ENTETES_ENREG.indexOf('cle') + 1;
    const aMigrerR = String(rap.getRange(1, colR).getValues()[0][0]).trim() !== 'cle';
    const aMigrerE = String(enr.getRange(1, colE).getValues()[0][0]).trim() !== 'cle';
    if (!aMigrerR && !aMigrerE) return resultat;

    const cId = ENTETES_RAPPORTS.indexOf('report_id');
    const cOrg = ENTETES_RAPPORTS.indexOf('org_name');
    const nR = rap.getLastRow() - 1;
    const lignesR = nR > 0 ? rap.getRange(2, 1, nR, Math.max(cId, cOrg) + 1).getValues() : [];
    const orgsParId = new Map();
    lignesR.forEach((r) => {
        const id = String(r[cId]).trim();
        if (!orgsParId.has(id)) orgsParId.set(id, new Set());
        orgsParId.get(id).add(String(r[cOrg] || '').trim().toLowerCase());
    });

    if (aMigrerR) {
        if (nR > 0) {
            rap.getRange(2, colR, nR, 1).setValues(lignesR.map(r => [celluleTexte_(cleRapport_(r[cOrg], r[cId]))]));
        }
        rap.getRange(1, colR).setValues([['cle']]);
        resultat.rapports = Math.max(nR, 0);
    }

    if (aMigrerE) {
        const nE = enr.getLastRow() - 1;
        if (nE > 0) {
            const cles = enr.getRange(2, 1, nE, 1).getValues().map(([id]) => {
                const orgs = orgsParId.get(String(id).trim());
                if (orgs && orgs.size === 1) return [celluleTexte_(cleRapport_([...orgs][0], id))];
                resultat.nonRattaches++;
                return [''];
            });
            enr.getRange(2, colE, nE, 1).setValues(cles);
        }
        enr.getRange(1, colE).setValues([['cle']]);
        resultat.enregistrements = Math.max(nE, 0);
    }
    SpreadsheetApp.flush();
    return resultat;
};

/**
 * Force une chaîne à rester du texte dans Sheets.
 *
 * `setValues` interprète ce qu'on lui donne, et le contenu d'un rapport DMARC
 * vient de n'importe qui — il suffit d'écrire à l'adresse rua :
 *   - `=IMPORTXML("https://…?"&A1)` deviendrait une formule, exécutée à
 *     l'ouverture du classeur et capable d'exfiltrer son contenu ;
 *   - un report_id numérique comme `10326483716373626337` (Google) deviendrait
 *     le nombre 1,03E+19 : 20 chiffres tronqués à 15, `idsExistants_` ne le
 *     reconnaissait plus, et deux rapports distincts pouvaient se confondre.
 * L'apostrophe initiale est la marque « texte » de Sheets : elle ne fait pas
 * partie de la valeur relue par `getValues()`.
 */
const celluleTexte_ = v => (typeof v === 'string' && v !== '' ? `'${v}` : v);

const ajouterLignes_ = (sh, lignes) => {
    if (!lignes.length) return;
    sh.getRange(sh.getLastRow() + 1, 1, lignes.length, lignes[0].length)
        .setValues(lignes.map(l => l.map(celluleTexte_)));
};

/**
 * Migration v1.7.0 : remplit la colonne dkim_diag des enregistrements existants,
 * à partir de colonnes déjà présentes (header_from, dkim_domaines,
 * dkim_resultats) : aucun cas ambigu. Même ordre que la migration de la clé :
 * les valeurs d'abord, l'en-tête ensuite, qui la marque comme faite.
 * Rend le nombre de lignes migrées (0 si rien à faire).
 */
const migrerDiagnosticDkim_ = (ss) => {
    const enr = ss.getSheetByName(CONFIG_DMARC.ONGLET_ENREG);
    if (!enr) return 0;
    const col = ENTETES_ENREG.indexOf('dkim_diag') + 1;
    if (String(enr.getRange(1, col).getValues()[0][0]).trim() === 'dkim_diag') return 0;
    const n = enr.getLastRow() - 1;
    if (n > 0) {
        const c = nom => ENTETES_ENREG.indexOf(nom);
        const lignes = enr.getRange(2, 1, n, ENTETES_ENREG.length).getValues();
        // Rapports (par clé) qui détaillent DKIM pour au moins un enregistrement.
        const detailles = new Set(lignes.filter(l => String(l[c('dkim_domaines')] || '').trim())
            .map(l => String(l[c('cle')])));
        enr.getRange(2, col, n, 1).setValues(lignes.map(l => [diagnosticDkim_(l[c('header_from')],
            l[c('dkim_domaines')], l[c('dkim_resultats')], detailles.has(String(l[c('cle')])))]));
    }
    enr.getRange(1, col).setValues([['dkim_diag']]);
    SpreadsheetApp.flush();
    return Math.max(n, 0);
};

/**
 * Erreur de service de Google (« Échec du service Feuilles de calcul »,
 * « Service Spreadsheets failed ») : générique, souvent passagère — document
 * occupé à recalculer après une grosse écriture. Toute autre erreur est un
 * défaut à corriger, jamais à relancer.
 */
const estErreurDeService_ = e => /(service).*(feuilles de calcul|spreadsheets)|(spreadsheets|feuilles de calcul).*(service)/i
    .test(String((e && e.message) || e));

/**
 * Exécute `action`, et la relance après une pause si Google répond par une
 * erreur de service. `action` doit pouvoir être rejouée sans dommage : les
 * appelants vérifient ce qui existe déjà avant de créer.
 * `suivi.reprises` compte les nouvelles tentatives, pour le Journal.
 */
const avecReprise_ = (action, suivi = {}, { essais = 3, pauseMs = 3000 } = {}) => {
    for (let essai = 1; ; essai += 1) {
        try {
            return action();
        } catch (e) {
            if (!estErreurDeService_(e) || essai >= essais) throw e;
            suivi.reprises = (suivi.reprises || 0) + 1;
            console.error(`Erreur de service, nouvelle tentative ${essai}/${essais - 1} : ${e}`);
            Utilities.sleep(pauseMs * essai);
        }
    }
};

