/**
 * DMARC — tableau de bord dans le classeur.
 * Introduit en v1.0.0.
 *
 * Construit une seule fois (menu DMARC > Créer / réinitialiser le tableau de
 * bord) : les indicateurs sont ensuite calculés par formules et se mettent à
 * jour d'eux-mêmes à chaque traitement.
 *
 * Crée :
 *  - "Tableau de bord" : filtres, indicateurs, tableaux et graphiques
 *  - "_Données" (masqué) : jointure Enregistrements + Rapports et
 *    colonnes de calcul utilisées par le tableau de bord
 */

/** Crée ou réinitialise le tableau de bord (menu DMARC). */
function creerTableauDeBord() {
    const ui = SpreadsheetApp.getUi();
    if (!verifierCompte_()) {
        ui.alert(`Cette action doit être lancée depuis le compte ${CONFIG_DMARC.COMPTE_TECHNIQUE} : `
            + 'seul le compte technique est autorisé à modifier le tableau de bord.');
        return;
    }

    // Étape en cours, nommée dans le message d'erreur : « Échec du service
    // Feuilles de calcul », seul, ne dit pas quelle opération Google a refusée.
    const suivi = { etape: 'ouverture du classeur' };
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    try {
        suivi.etape = 'vérification des onglets Rapports et Enregistrements';
        if (!ss.getSheetByName(CONFIG_DMARC.ONGLET_ENREG) || !ss.getSheetByName(CONFIG_DMARC.ONGLET_RAPPORTS)) {
            ui.alert(`Les onglets « ${CONFIG_DMARC.ONGLET_RAPPORTS} » et « ${CONFIG_DMARC.ONGLET_ENREG} » `
                + 'n\'existent pas encore. Lancez d\'abord DMARC > Traiter les rapports maintenant '
                + `depuis le compte ${CONFIG_DMARC.COMPTE_TECHNIQUE}.`);
            return;
        }

        // La réinitialisation supprime les deux onglets : tout ajout manuel
        // (commentaire, graphique personnel) y serait perdu sans retour possible.
        if (ss.getSheetByName(TABLEAU_DMARC.FEUILLE)) {
            const reponse = ui.alert('Réinitialiser le tableau de bord ?',
                `Les onglets « ${TABLEAU_DMARC.FEUILLE} » et « ${TABLEAU_DMARC.DONNEES} » seront supprimés `
                + 'puis recréés. Les données des rapports ne sont pas touchées, mais toute '
                + 'modification manuelle de ces deux onglets sera perdue.', ui.ButtonSet.OK_CANCEL);
            if (reponse !== ui.Button.OK) return;
        }

        // Suppression puis création : les deux points où Google a répondu
        // « Échec du service Feuilles de calcul » dans le classeur réel, juste
        // après un traitement qui avait réécrit des milliers de lignes (document
        // occupé à recalculer _Données). Chaque opération est rejouable : elle
        // vérifie d'abord ce qui existe déjà.
        suivi.etape = 'suppression de l\'ancien tableau de bord';
        let supprime = false;
        [TABLEAU_DMARC.FEUILLE, TABLEAU_DMARC.DONNEES].forEach((n) => {
            avecReprise_(() => {
                const s = ss.getSheetByName(n);
                if (s) { ss.deleteSheet(s); supprime = true; }
            }, suivi);
        });
        if (supprime) {
            // Laisser Sheets finir la suppression (et le recalcul qu'elle déclenche)
            // avant de recréer des onglets du même nom.
            SpreadsheetApp.flush();
            Utilities.sleep(2000);
        }

        suivi.etape = 'création des onglets Tableau de bord et _Données';
        const tdb = avecReprise_(() => ss.getSheetByName(TABLEAU_DMARC.FEUILLE)
            || ss.insertSheet(TABLEAU_DMARC.FEUILLE, 0), suivi);
        const don = avecReprise_(() => ss.getSheetByName(TABLEAU_DMARC.DONNEES)
            || ss.insertSheet(TABLEAU_DMARC.DONNEES), suivi);
        // Les formules citent ces onglets : ils doivent exister avant elles.
        suivi.etape = 'lecture des Paramètres, onglets Journal et _CacheIP';
        const { valeurs: parametres } = lireParametres_(ss);
        feuille_(ss, CONFIG_DMARC.ONGLET_JOURNAL, ENTETES_JOURNAL);
        feuille_(ss, CONFIG_DMARC.ONGLET_CACHE_IP, ENTETES_CACHE_IP).hideSheet();
        avecSyntaxeAnglaise_(ss, () => {
            suivi.etape = 'formules de l\'onglet _Données';
            construireDonnees_(ss, don);
            suivi.etape = 'mise en page et formules du tableau de bord';
            construireTableau_(tdb, don, parametres);
        }, suivi);
        suivi.etape = 'masquage de l\'onglet _Données';
        don.hideSheet();
        suivi.etape = 'onglet Aide';
        mettreAJourAideSiNecessaire_(ss);
        suivi.etape = 'affichage du tableau de bord';
        ss.setActiveSheet(tdb);
        // Chaque création réussie laisse une ligne : sans elle, un échec suivi
        // d'une réussite ne se distinguait pas d'un échec resté sans suite.
        journaliser_(ss, 'création du tableau de bord', suivi.reprises
            ? `Tableau de bord créé, après ${suivi.reprises} nouvelle(s) tentative(s) sur « Échec du service `
                + 'Feuilles de calcul ». Si ce message revient souvent, le signaler.'
            : 'Tableau de bord créé.');
    } catch (e) {
        const message = `Échec à l'étape « ${suivi.etape} »`
            + (suivi.reprises ? ` (après ${suivi.reprises} nouvelle(s) tentative(s))` : '') + ` : ${e.message || e}`;
        console.error(`Création du tableau de bord — ${message}`);
        journaliser_(ss, 'création du tableau de bord', `ÉCHEC — ${message}`);
        ui.alert('Impossible de générer le tableau de bord', `${message}\n\n`
            + 'Relancez une fois : cette erreur de Google est parfois passagère. Si elle revient à la même '
            + 'étape, transmettez ce message (il est aussi dans l\'onglet Journal).', ui.ButtonSet.OK);
    }
}

/**
 * Exécute `ecrire` sous les paramètres régionaux en_US, puis rétablit ceux du
 * classeur, quoi qu'il arrive.
 *
 * Les formules sont écrites à l'anglaise : virgule entre les arguments, point
 * décimal. La documentation de setFormula ne dit rien de la langue, et un
 * classeur en français les lit à la française, où « , » est le séparateur
 * décimal et « ; » celui des arguments : `_Données!A2` y restait en erreur. En
 * écrivant sous en_US, puis en rétablissant la langue, on laisse Sheets
 * retraduire lui-même les formules (« ; », SI, RECHERCHEV…), comme lorsqu'on
 * change la langue à la main. C'est valable quelle que soit la langue, sans
 * table de séparateurs à tenir à jour.
 *
 * Pendant les quelques secondes de la construction, un autre lecteur du
 * classeur verrait les nombres au format anglais.
 */
const avecSyntaxeAnglaise_ = (ss, ecrire, suivi = {}) => {
    const langue = ss.getSpreadsheetLocale();
    if (/^en(_|$)/i.test(langue)) return ecrire();
    suivi.etape = 'passage du classeur en en_US';
    ss.setSpreadsheetLocale('en_US');
    try {
        const resultat = ecrire();
        suivi.etape = 'calcul des formules sous en_US (flush)';
        SpreadsheetApp.flush(); // les formules sont lues sous en_US avant le retour
        return resultat;
    } finally {
        // Le finally ne doit pas masquer l'étape qui a échoué : il ne la
        // renomme que s'il échoue lui-même.
        const etapeFautive = suivi.etape;
        try {
            ss.setSpreadsheetLocale(langue);
            SpreadsheetApp.flush();
        } catch (e) {
            suivi.etape = `retour à la langue ${langue} (après : ${etapeFautive})`;
            throw e;
        }
    }
};

/**
 * Ajuste la taille de l'onglet "_Données" pour que les formules
 * matricielles aient toujours la place de s'étendre.
 * Appelé à la fin de chaque traitement.
 */
const ajusterTableauDeBord_ = (ss) => {
    const don = ss.getSheetByName(TABLEAU_DMARC.DONNEES);
    const enr = ss.getSheetByName(CONFIG_DMARC.ONGLET_ENREG);
    if (!don || !enr) return;
    const besoin = enr.getLastRow() + 200;
    if (don.getMaxRows() < besoin) {
        don.insertRowsAfter(don.getMaxRows(), besoin - don.getMaxRows());
    }
};

/* ===================== Filtre Période ===================== */

/** Durées usuelles proposées par le filtre Période, en jours. */
const PERIODES_STANDARD_TABLEAU = Object.freeze([7, 30, 90, 180, 365]);

/** Jours que peut montrer le graphique « Évolution quotidienne » (lignes 89 à 588). */
const JOURS_MAX_GRAPHIQUE = 500;

/**
 * Choix du filtre Période : les durées usuelles sous la rétention, puis la
 * rétention elle-même, plafonnées par le graphique. Proposer 3 650 jours
 * quand la purge ne garde que 180 jours promettait des données qui n'existent
 * plus.
 */
const choixPeriodes_ = (retention) => {
    const plafond = Math.min(retention, JOURS_MAX_GRAPHIQUE);
    return [...PERIODES_STANDARD_TABLEAU.filter(j => j < plafond), plafond].map(String);
};

/**
 * Pose la liste du filtre Période d'après la rétention. Si la valeur choisie
 * n'est plus proposée (rétention abaissée), elle est ramenée au plus grand
 * choix : un filtre hors liste afficherait une période vide sans le dire.
 * Rend le nouveau nombre de jours, ou null si rien n'a changé.
 */
const alignerFiltrePeriode_ = (sh, parametres) => {
    const choix = choixPeriodes_(parametres.JOURS_RETENTION);
    const cellule = sh.getRange('C5');
    cellule.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(choix, true).build());
    const actuel = String(cellule.getValues()[0][0]).trim();
    if (choix.includes(actuel)) return null;
    const ramene = Number(choix[choix.length - 1]);
    cellule.setValue(ramene);
    return ramene;
};

/** Lettre de colonne (1 → A, 14 → N, 27 → AA). */
const colonneLettre_ = (n) => {
    let s = '';
    for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
    return s;
};

/* ===================== Onglet _Données ===================== */

const construireDonnees_ = (ss, don) => {
    ajusterTableauDeBord_(ss);

    const f = `'${TABLEAU_DMARC.FEUILLE}'`; // référence au tableau de bord
    const enr = `'${CONFIG_DMARC.ONGLET_ENREG}'`;
    const rap = `'${CONFIG_DMARC.ONGLET_RAPPORTS}'`;
    don.getRange(1, 1, 1, 23).setValues([[
        'report_id', 'domaine', 'source_ip', 'count', 'disposition', 'dkim_eval',
        'spf_eval', 'header_from', 'envelope_from', 'dkim_domaines', 'dkim_resultats',
        'spf_domaines', 'spf_resultats', 'date', 'emetteur',
        'inclus', 'conforme', 'msg', 'msg_conformes', 'msg_dkim_ok', 'msg_spf_ok',
        'msg_rejetes', 'msg_nc_non_rejetes'
    ]]);

    // Aucun tableau littéral {…} dans les formules posées par le script : Sheets
    // traduit les séparateurs d'arguments selon la langue du classeur, mais pas
    // ceux d'un tableau littéral. En français, le séparateur de colonnes y est
    // « \ » : `{A2:M,…}` y devenait une formule invalide. HSTACK et VSTACK
    // prennent des arguments ordinaires, que Sheets traduit correctement.

    // A:O — jointure Enregistrements + date et émetteur issus de Rapports,
    // par la colonne cle (émetteur|report_id) : joindre par le seul report_id
    // prêtait au rapport d'un second émetteur la date et le nom du premier.
    const cleE = colonneLettre_(ENTETES_ENREG.indexOf('cle') + 1);
    const cleR = colonneLettre_(ENTETES_RAPPORTS.indexOf('cle') + 1);
    const rechercher = colonne =>
        `IFERROR(VLOOKUP(${enr}!${cleE}2:${cleE},HSTACK(${rap}!${cleR}2:${cleR},${rap}!${colonne}2:${colonne}),2,FALSE),"")`;
    don.getRange('A2').setFormula(
        `=IFERROR(ARRAYFORMULA(FILTER(HSTACK(${enr}!A2:M,${rechercher('D')},${rechercher('B')}),` +
        `${enr}!A2:A<>"")),"")`);

    // P — ligne incluse selon les filtres (domaine + période)
    don.getRange('P2').setFormula(
        `=ARRAYFORMULA(IF(A2:A="","",` +
        `IF((${f}!$C$4="Tous")+(B2:B=${f}!$C$4),1,0)*` +
        `IF(IFERROR(N2:N*1,0)>=TODAY()-${f}!$C$5*1,1,0)))`);

    // Q — conforme DMARC (DKIM ou SPF aligné)
    don.getRange('Q2').setFormula(
        '=ARRAYFORMULA(IF(A2:A="","",IF((F2:F="pass")+(G2:G="pass"),1,0)))');

    // R:W — volumes pondérés par le filtre
    const formules = {
        R2: 'D2:D*P2:P',
        S2: 'D2:D*P2:P*Q2:Q',
        T2: 'D2:D*P2:P*IF(F2:F="pass",1,0)',
        U2: 'D2:D*P2:P*IF(G2:G="pass",1,0)',
        V2: 'D2:D*P2:P*IF(E2:E="reject",1,0)',
        W2: 'D2:D*P2:P*(1-Q2:Q)*IF(E2:E="reject",0,1)'
    };
    Object.entries(formules).forEach(([cell, expr]) =>
        don.getRange(cell).setFormula(`=ARRAYFORMULA(IF(A2:A="","",${expr}))`));

    // X — liste des domaines pour le menu déroulant
    don.getRange('X1').setFormula(
        `=VSTACK("Tous",IFERROR(SORT(UNIQUE(FILTER(${enr}!B2:B,${enr}!B2:B<>""))),""))`);

    // Y — diagnostic DKIM (calculé par le script à l'enregistrement). Hors du
    // bloc A:W pour ne décaler aucune colonne existante ; même condition de
    // FILTER qu'en A2, donc mêmes lignes, dans le même ordre.
    const diagE = colonneLettre_(ENTETES_ENREG.indexOf('dkim_diag') + 1);
    don.getRange('Y1').setValue('dkim_diag');
    don.getRange('Y2').setFormula(`=IFERROR(FILTER(${enr}!${diagE}2:${diagE},${enr}!A2:A<>""),"")`);
};

/* ===================== Onglet Tableau de bord ===================== */

const construireTableau_ = (sh, don, parametres) => {
    const D = `'${TABLEAU_DMARC.DONNEES}'`;
    const q = (requete) =>
        `=IFERROR(QUERY(${D}!A2:Y,"${requete}",0),"Aucune donnée")`;

    sh.setHiddenGridlines(true);
    [[1, 20], [2, 190], [3, 150], [4, 160], [5, 130], [6, 130], [7, 110], [8, 220]]
        .forEach(([c, w]) => sh.setColumnWidth(c, w));

    // En-tête
    sh.getRange('B1').setValue('Tableau de bord DMARC')
        .setFontSize(18).setFontWeight('bold');
    // Deux dates distinctes : l'heure du dernier passage (Journal) et celle du
    // dernier rapport enregistré. L'ancien libellé « Dernier traitement »
    // affichait la seconde : un déclencheur tombé ne se voyait pas. COUNT
    // d'abord : MAX d'une plage vide vaut 0, qui s'affiche « 30/12/1899 ».
    //
    // Pas de TEXT(…; "dd/mm/yyyy") : le motif, entre guillemets, n'est pas
    // traduit, et ses codes dépendent de la langue du classeur — il échouait en
    // français. La date va seule dans sa cellule, mise en forme par l'API,
    // dont les motifs ne dépendent pas de la langue.
    const dateOuTiret = plage => `=IF(COUNT(${plage})=0,"—",MAX(${plage}))`;
    sh.getRange('B2:G2').setValues([['Dernier passage :', '', 'Dernier rapport :', '', '', '']])
        .setFontColor('#666666');
    sh.getRange('C2').setFormula(dateOuTiret(`'${CONFIG_DMARC.ONGLET_JOURNAL}'!A2:A`));
    sh.getRange('E2').setFormula(dateOuTiret(`'${CONFIG_DMARC.ONGLET_RAPPORTS}'!M2:M`));
    sh.getRange('C2:E2').setNumberFormat('dd/mm/yyyy hh:mm').setFontColor('#666666')
        .setHorizontalAlignment('left');
    sh.getRange('B2').setNote(`Le détail de chaque passage est dans l'onglet « ${CONFIG_DMARC.ONGLET_JOURNAL} ». `
        + 'Un « dernier passage » qui date de plus d\'une heure signale un déclencheur arrêté.');

    // Filtres
    sh.getRange('B4:B5').setValues([['Domaine'], ['Période (jours)']]).setFontWeight('bold');
    sh.getRange('C4').setValue('Tous').setDataValidation(
        SpreadsheetApp.newDataValidation()
            .requireValueInRange(don.getRange('X1:X'), true).build());
    sh.getRange('C5').setValue(30);
    alignerFiltrePeriode_(sh, parametres);
    sh.getRange('C4:C5').setBackground('#fff8e1').setHorizontalAlignment('left');
    sh.getRange('B5').setNote('La période porte sur la date de début des rapports (date_debut), pas sur '
        + 'leur date de réception. Les choix ne dépassent ni la durée de conservation (JOURS_RETENTION, '
        + `onglet « ${CONFIG_DMARC.ONGLET_PARAMETRES} ») ni les ${JOURS_MAX_GRAPHIQUE} jours que montre le `
        + 'graphique d\'évolution : au-delà, il n\'y aurait rien à afficher.');

    // Pourcentages par ROUND et non TEXT(…; "0.0%") : un nombre concaténé
    // prend le séparateur décimal de la langue du classeur (95,5 en français),
    // quand le motif de TEXT, lui, n'est pas traduit.
    //
    // Diagnostic de préparation à p=reject (E4:G5). Il ne vaut que domaine par
    // domaine : sur « Tous », un domaine prêt et un domaine qui ne l'est pas
    // donnent une moyenne qui ne décrit aucun des deux. Les seuils se lisent
    // dans l'onglet Paramètres, pour se régler sans toucher au code.
    const seuil = cle => `VLOOKUP("${cle}",'${CONFIG_DMARC.ONGLET_PARAMETRES}'!A:B,2,FALSE)`;
    sh.getRange('E4:G4').merge().setValue('Diagnostic de politique (indicatif)')
        .setFontWeight('bold').setFontColor('#444444').setHorizontalAlignment('center');
    sh.getRange('E5:G5').merge().setFormula(
        '=IF($C$4="Tous","Choisissez un domaine en C4 : ce diagnostic ne vaut que domaine par domaine.",'
        + 'IF(NOT(ISNUMBER(C8)),"En attente de données",'
        + `IF(C8>=${seuil('SEUIL_PRET_REJECT')},`
        + '"🟢 Conformité "&ROUND(C8*100,1)&" % : p=reject envisageable, après revue des sources non conformes",'
        + `IF(C8>=${seuil('SEUIL_PRET_QUARANTINE')},`
        + '"🟡 Conformité "&ROUND(C8*100,1)&" % : p=quarantine envisageable avant p=reject",'
        + '"🔴 "&ROUND((1-C8)*100,1)&" % de messages non conformes : rester en p=none et corriger les sources"))))'
    ).setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center').setWrap(true)
        .setBackground('#f8f9fa').setBorder(true, true, true, true, false, false, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange('E4').setNote('Indicatif : compare le taux de conformité du domaine choisi, sur la période choisie, '
        + `aux seuils SEUIL_PRET_REJECT et SEUIL_PRET_QUARANTINE de l'onglet « ${CONFIG_DMARC.ONGLET_PARAMETRES} ». `
        + 'Avant de durcir la politique, vérifiez que chaque source non conforme restante est illégitime '
        + '(le Top 15 plus bas) : un taux élevé peut cacher un service légitime à faible volume.');

    // Indicateurs clés
    const indicateurs = [
        ['Messages', 'Somme des « count » des enregistrements retenus par les filtres.'],
        ['Taux de conformité', 'Messages conformes DMARC / messages. Conforme = DKIM OU SPF '
            + 'passe et est aligné sur le domaine From (policy_evaluated). '
            + 'Couleurs : mêmes seuils que le diagnostic (SEUIL_PRET_QUARANTINE, SEUIL_PRET_REJECT, '
            + `onglet « ${CONFIG_DMARC.ONGLET_PARAMETRES} »).`],
        ['Taux DKIM', 'Part des messages dont DKIM est aligné et valide (policy_evaluated/dkim = pass).'],
        ['Taux SPF', 'Part des messages dont SPF est aligné et valide (policy_evaluated/spf = pass).'],
        ['Messages rejetés', 'Messages que le destinataire dit avoir rejetés (disposition = reject).'],
        ['Non conformes non rejetés', 'Messages non conformes que le destinataire a tout de même '
            + 'acceptés (disposition none ou quarantine) : c\'est ce que la politique p= laisse passer.']
    ];
    sh.getRange('B7:G7').setValues([indicateurs.map(([titre]) => titre)])
        .setNotes([indicateurs.map(([, note]) => note)])
        .setFontWeight('bold').setFontColor('#555555').setWrap(true);
    sh.getRange('B8:G8').setFormulas([[
        `=SUM(${D}!R2:R)`,
        `=IFERROR(SUM(${D}!S2:S)/SUM(${D}!R2:R),"—")`,
        `=IFERROR(SUM(${D}!T2:T)/SUM(${D}!R2:R),"—")`,
        `=IFERROR(SUM(${D}!U2:U)/SUM(${D}!R2:R),"—")`,
        `=SUM(${D}!V2:V)`,
        `=SUM(${D}!W2:W)`
    ]]).setFontSize(16).setFontWeight('bold');
    sh.getRange('B8').setNumberFormat('#,##0');
    sh.getRange('C8:E8').setNumberFormat('0.0%');
    sh.getRange('F8:G8').setNumberFormat('#,##0');
    sh.getRange('B7:G8').setBackground('#f1f3f4')
        .setBorder(true, true, true, true, true, false, '#dadce0', SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange('B9').setValue('Survolez un intitulé pour voir comment le chiffre est calculé. '
        + `Les calculs vivent dans l'onglet masqué « ${TABLEAU_DMARC.DONNEES} » (bouton ☰ en bas à gauche) : `
        + 'ne le supprimez pas.')
        .setFontColor('#888888').setFontSize(9);

    // Sections : [ligne titre, titre, formule]
    const sections = [
        [11, `Conformité par domaine (${TABLEAU_DMARC.MAX_DOMAINES} plus gros volumes)`, q(
            "select B, sum(D), sum(S)/sum(D) where P = 1 group by B order by sum(D) desc " +
            `limit ${TABLEAU_DMARC.MAX_DOMAINES} ` +
            "label B 'Domaine', sum(D) 'Messages', sum(S)/sum(D) 'Taux de conformité'"), 3],
        [45, 'Top 15 des sources non conformes', q(
            "select B, C, I, E, Y, sum(D) where P = 1 and Q = 0 group by B, C, I, E, Y " +
            "order by sum(D) desc limit 15 " +
            "label B 'Domaine', C 'IP source', I 'Envelope from', E 'Disposition', Y 'DKIM', " +
            "sum(D) 'Messages'"), 6],
        [64, 'Dispositions appliquées', q(
            "select E, sum(D) where P = 1 group by E order by sum(D) desc " +
            "label E 'Disposition', sum(D) 'Messages'"), 2],
        [73, 'Émetteurs de rapports', q(
            "select O, sum(D) where P = 1 group by O order by sum(D) desc limit 10 " +
            "label O 'Émetteur', sum(D) 'Messages'"), 2],
        [87, 'Évolution quotidienne', q(
            "select toDate(N), sum(D), sum(S) where P = 1 group by toDate(N) order by toDate(N) " +
            "label toDate(N) 'Jour', sum(D) 'Messages', sum(S) 'Conformes'"), 3]
    ];
    sections.forEach(([ligne, titre, formule, largeur]) => {
        sh.getRange(ligne, 2).setValue(titre).setFontSize(12).setFontWeight('bold');
        sh.getRange(ligne + 1, 2).setFormula(formule);
        sh.getRange(ligne + 1, 2, 1, largeur).setFontWeight('bold').setBackground('#e8eaed');
    });
    sh.getRange(TABLEAU_DMARC.LIGNE_TOP_SOURCES - 1, 6).setNote('Signature DKIM de la source : '
        + 'voir le tableau « Non conformes : signature DKIM » plus bas pour le sens de chaque valeur.');

    // Non conformes selon la signature DKIM (E64:F68) : sépare le message
    // légitime abîmé en route (DKIM cassé) de l'usurpation probable (absent).
    const diagnostics = [
        [DIAGNOSTICS_DKIM.CASSE, 'Signé par votre domaine, puis modifié en route (transfert, passerelle de '
            + 'filtrage qui ajoute un bandeau ou réécrit les liens). Un usurpateur ne peut pas signer à votre '
            + 'nom : message légitime très probablement, rejeté à cause d\'un intermédiaire du destinataire.'],
        [DIAGNOSTICS_DKIM.TIERS, 'Signé seulement par un autre domaine : prestataire qui n\'a pas la '
            + 'signature à votre nom (à configurer), ou usurpateur qui signe avec son propre domaine. À examiner.'],
        [DIAGNOSTICS_DKIM.ABSENT, 'Aucune signature, alors que l\'émetteur du rapport détaille DKIM ailleurs : '
            + 'usurpation probable, ou serveur légitime sans DKIM (à configurer).'],
        [DIAGNOSTICS_DKIM.NON_RENSEIGNE, 'L\'émetteur du rapport ne détaille DKIM pour aucun message de ce '
            + 'rapport (la RFC le permet) : impossible de trancher. Regardez le nom d\'hôte de la source.']
    ];
    sh.getRange('E64').setValue('Non conformes : signature DKIM').setFontSize(12).setFontWeight('bold');
    sh.getRange('E65:F65').setValues([['Signature', 'Messages']]).setFontWeight('bold').setBackground('#e8eaed');
    sh.getRange(66, 5, diagnostics.length, 1).setValues(diagnostics.map(([d]) => [d]))
        .setNotes(diagnostics.map(([, note]) => [note]));
    sh.getRange(66, 6, diagnostics.length, 1).setFormulas(diagnostics.map(([d]) => [
        `=IFERROR(SUM(FILTER(${D}!R2:R,${D}!Q2:Q=0,${D}!Y2:Y="${d.replace(/"/g, '""')}")),0)`
    ])).setNumberFormat('#,##0');
    sh.getRange(66 + diagnostics.length, 5).setValue('Survolez chaque ligne pour sa lecture.').setFontColor('#888888').setFontSize(9);

    // Colonne H du Top 15 : nom d'hôte vérifié, lu par formule dans _CacheIP.
    // Une formule suit l'IP de sa ligne ; des notes posées sur les cellules
    // décrivaient une autre IP dès qu'un lecteur changeait de filtre.
    const premiere = TABLEAU_DMARC.LIGNE_TOP_SOURCES;
    sh.getRange(premiere - 1, 8).setValue('Nom d\'hôte (DNS inverse vérifié)')
        .setFontWeight('bold').setBackground('#e8eaed')
        .setNote('Nom d\'hôte de l\'IP (PTR), cru seulement s\'il renvoie lui-même vers cette IP. '
            + '« NON VÉRIFIÉ » : le détenteur de l\'IP s\'attribue un nom qui ne pointe pas vers elle — '
            + 'ne pas s\'y fier. Résolu au fil des traitements horaires ; « en attente » en attendant.');
    sh.getRange(premiere, 8, 15, 1).setFormulas(Array.from({ length: 15 }, (_, i) => [
        `=IF(C${premiere + i}="","",IFERROR(VLOOKUP(C${premiere + i},'${CONFIG_DMARC.ONGLET_CACHE_IP}'!A:B,2,FALSE),"en attente de résolution"))`
    ])).setFontColor('#555555');

    // Formats des tableaux
    sh.getRange('C13:C42').setNumberFormat('#,##0');
    sh.getRange('D13:D42').setNumberFormat('0.0%');
    sh.getRange('G47:G61').setNumberFormat('#,##0');
    sh.getRange('C66:C71').setNumberFormat('#,##0');
    sh.getRange('C75:C84').setNumberFormat('#,##0');
    sh.getRange('B89:B588').setNumberFormat('dd/mm/yyyy');
    sh.getRange('C89:D588').setNumberFormat('#,##0');

    // Mise en forme conditionnelle sur les taux : les bandes du diagnostic,
    // lues dans Paramètres. Un seuil de couleur écrit en dur (98 %) donnait un
    // fond vert à 98,5 % pendant que le diagnostic affichait 🟡.
    // Une formule de mise en forme ne cite un autre onglet que par INDIRECT,
    // et ses références sont relatives à la cellule en haut à gauche de la
    // plage : une règle par plage.
    const seuilIndirect = cle =>
        `VLOOKUP("${cle}",INDIRECT("'${CONFIG_DMARC.ONGLET_PARAMETRES}'!A:B"),2,FALSE)`;
    const bandes = [
        ['#f4c7c3', c => `=AND(ISNUMBER(${c}),${c}<${seuilIndirect('SEUIL_PRET_QUARANTINE')})`],
        ['#fce8b2', c => `=AND(ISNUMBER(${c}),${c}>=${seuilIndirect('SEUIL_PRET_QUARANTINE')},`
            + `${c}<${seuilIndirect('SEUIL_PRET_REJECT')})`],
        ['#b7e1cd', c => `=AND(ISNUMBER(${c}),${c}>=${seuilIndirect('SEUIL_PRET_REJECT')})`]
    ];
    sh.setConditionalFormatRules([['C8', 'C8'], ['D13:D42', 'D13']].flatMap(([plage, coin]) =>
        bandes.map(([couleur, formule]) => SpreadsheetApp.newConditionalFormatRule()
            .whenFormulaSatisfied(formule(coin)).setBackground(couleur)
            .setRanges([sh.getRange(plage)]).build())));

    // Graphiques (colonne I, empilés)
    const graphique = (type, plagesGraphique, ligne, options) => {
        let b = sh.newChart().setChartType(type).setNumHeaders(1)
            .setPosition(ligne, 9, 0, 0) // colonne I : H porte le nom d'hôte du Top 15
            .setOption('width', 620).setOption('height', 360);
        plagesGraphique.forEach(p => { b = b.addRange(sh.getRange(p)); });
        Object.entries(options).forEach(([k, v]) => { b = b.setOption(k, v); });
        sh.insertChart(b.build());
    };

    graphique(Charts.ChartType.BAR, ['B12:B42', 'D12:D42'], 4, {
        title: 'Taux de conformité par domaine',
        legend: { position: 'none' },
        hAxis: { format: 'percent', viewWindow: { min: 0, max: 1 } }
    });
    graphique(Charts.ChartType.LINE, ['B88:D588'], 23, {
        title: 'Évolution quotidienne des messages',
        legend: { position: 'bottom' },
        hAxis: { format: 'dd/MM' }
    });
    graphique(Charts.ChartType.PIE, ['B65:C71'], 42, {
        title: 'Dispositions appliquées par les destinataires',
        pieHole: 0.4
    });
    graphique(Charts.ChartType.COLUMN, ['B74:C84'], 61, {
        title: 'Messages par émetteur de rapports',
        legend: { position: 'none' }
    });
};
