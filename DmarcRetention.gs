/**
 * DMARC — rétention : archivage CSV puis purge des données anciennes.
 * Introduit en v1.2.0.
 *
 * Opération irréversible, donc en deux temps : `planifierPurge_` compte sans
 * rien toucher, le menu annonce les chiffres exacts et demande confirmation,
 * puis `archiverEtPurgerAnciennesLignes_` refait le plan sous verrou et
 * l'applique. Sans dossier d'archive, la purge est refusée : rien ne sort du
 * classeur sans copie.
 */

/**
 * Neutralise une cellule de CSV : le contenu vient des rapports, que n'importe
 * qui peut envoyer, et un `=…` s'exécuterait à l'ouverture dans Sheets ou Excel.
 */
const celluleCsv_ = (val) => {
    if (estDate_(val)) return val.toISOString();
    if (val === null || val === undefined) return '';
    let s = String(val);
    if (typeof val === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Convertit un tableau 2D de cellules en CSV (RFC 4180, dates en ISO 8601 UTC). */
const convertirEnCsv_ = (entetes, lignes) =>
    [entetes, ...lignes].map(l => l.map(celluleCsv_).join(',')).join('\r\n');

/**
 * Sépare ce qui est à purger de ce qui reste, sans rien écrire.
 * Critère : `date_fin` du rapport antérieure à la limite.
 */
const planifierPurge_ = (ss, jours, maintenant = Date.now()) => {
    const shRapports = ss.getSheetByName(CONFIG_DMARC.ONGLET_RAPPORTS);
    const shEnreg = ss.getSheetByName(CONFIG_DMARC.ONGLET_ENREG);
    const vide = { rapArchives: [], rapRestantes: [], enrArchives: [], enrRestantes: [], nR: 0, nE: 0 };
    if (!shRapports || !shEnreg || shRapports.getLastRow() < 2) return vide;

    const limite = maintenant - jours * UN_JOUR_MS_DMARC;
    const colFin = ENTETES_RAPPORTS.indexOf('date_fin');
    const nR = shRapports.getLastRow() - 1;
    const plan = { rapArchives: [], rapRestantes: [], enrArchives: [], enrRestantes: [], nR, nE: 0 };

    const ids = new Set();
    shRapports.getRange(2, 1, nR, ENTETES_RAPPORTS.length).getValues().forEach((r) => {
        if (estDate_(r[colFin]) && r[colFin].getTime() < limite) {
            ids.add(String(r[ENTETES_RAPPORTS.indexOf('cle')]));
            plan.rapArchives.push(r);
        } else {
            plan.rapRestantes.push(r);
        }
    });
    if (!ids.size) return plan;

    plan.nE = Math.max(shEnreg.getLastRow() - 1, 0);
    if (plan.nE) {
        shEnreg.getRange(2, 1, plan.nE, ENTETES_ENREG.length).getValues().forEach((r) => {
            (ids.has(String(r[ENTETES_ENREG.indexOf('cle')])) ? plan.enrArchives : plan.enrRestantes).push(r);
        });
    }
    return plan;
};

/**
 * Réécrit un onglet avec les seules lignes conservées.
 *
 * Écriture d'abord, effacement de la fin ensuite : « effacer puis réécrire »
 * laissait un instant où les données n'existaient plus nulle part.
 */
const reecrireOnglet_ = (sh, restantes, ancienNombre, largeur) => {
    if (restantes.length) {
        sh.getRange(2, 1, restantes.length, largeur).setValues(restantes.map(l => l.map(celluleTexte_)));
    }
    if (ancienNombre > restantes.length) {
        sh.getRange(restantes.length + 2, 1, ancienNombre - restantes.length, largeur).clearContent();
    }
};

/**
 * Archive en CSV dans Drive puis purge les lignes plus anciennes que `jours`.
 *
 * Prend le verrou du traitement : sans lui, un passage horaire concurrent
 * écrivait ses lignes dans la zone en cours de réécriture, et elles étaient
 * écrasées alors que leurs fils étaient déjà à la corbeille.
 */
const archiverEtPurgerAnciennesLignes_ = (ss, jours, maintenant = Date.now()) => {
    const dossier = obtenirDossierArchive_(); // lève si configuré mais inaccessible
    if (!dossier) {
        throw new Error('Purge refusée : aucun dossier d\'archivage Drive n\'est configuré, les données '
            + 'supprimées ne seraient sauvegardées nulle part. Configurez-le par DMARC > '
            + 'Configurer le dossier d\'archivage Drive.');
    }

    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(10 * 1000)) {
        throw new Error('Un traitement des rapports est en cours. Relancez la purge dans quelques minutes.');
    }
    try {
        const plan = planifierPurge_(ss, jours, maintenant);
        if (!plan.rapArchives.length) return { rapportsPurges: 0, enregPurges: 0, fichiers: [] };

        // 1. Archive complète AVANT toute suppression ; un échec Drive lève ici.
        const horodatage = Utilities.formatDate(new Date(maintenant), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
        const fichiers = [
            // La version va dans le nom, pas dans le contenu : une ligne de plus
            // en tête casserait l'import du CSV.
            [`dmarc_rapports_purges_${horodatage}_v${VERSION_DMARC}.csv`,
                convertirEnCsv_(ENTETES_RAPPORTS, plan.rapArchives)],
            [`dmarc_enregistrements_purges_${horodatage}_v${VERSION_DMARC}.csv`,
                convertirEnCsv_(ENTETES_ENREG, plan.enrArchives)]
        ].map(([nom, contenu]) => {
            dossier.createFile(Utilities.newBlob(contenu, 'text/csv', nom));
            return nom;
        });

        // 2. Réécriture des deux onglets.
        const shRapports = ss.getSheetByName(CONFIG_DMARC.ONGLET_RAPPORTS);
        const shEnreg = ss.getSheetByName(CONFIG_DMARC.ONGLET_ENREG);
        reecrireOnglet_(shRapports, plan.rapRestantes, plan.nR, ENTETES_RAPPORTS.length);
        reecrireOnglet_(shEnreg, plan.enrRestantes, plan.nE, ENTETES_ENREG.length);
        SpreadsheetApp.flush();

        return { rapportsPurges: plan.rapArchives.length, enregPurges: plan.enrArchives.length, fichiers };
    } finally {
        verrou.releaseLock();
    }
};
