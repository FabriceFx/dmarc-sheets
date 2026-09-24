/**
 * DMARC — onglet « Paramètres » : seuils et durées modifiables sans déploiement.
 * Introduit en v1.2.0.
 *
 * Un seuil d'alerte ou une durée de rétention est un choix de politique, pas
 * de code : il vit dans un onglet que l'administrateur modifie, et la valeur
 * prend effet au passage suivant. Le code n'y ajoute que les clés absentes et
 * ne réécrit jamais une valeur saisie. Une valeur invalide n'est pas devinée :
 * la valeur par défaut s'applique, et le bilan le dit.
 */

/**
 * Paramètres connus : valeur par défaut, bornes, explication affichée dans
 * l'onglet. Les bornes servent deux fois — contrôle à la lecture et validation
 * de données posée sur la cellule — pour que les deux ne divergent jamais.
 */
const PARAMETRES_DMARC = Object.freeze([
    {
        cle: 'SEUIL_ALERTE_CONFORMITE', defaut: 0.95,
        min: 0.01, max: 1,
        aide: 'Alerte si, sur les rapports reçus en 24 h, le taux de conformité d\'un domaine '
            + 'passe sous ce seuil. 0,95 = 95 %.'
    },
    {
        cle: 'SEUIL_ALERTE_REJETS', defaut: 50,
        min: 1, entier: true,
        aide: 'Alerte si, sur les rapports reçus en 24 h, les destinataires disent avoir rejeté '
            + 'au moins ce nombre de messages non conformes d\'un domaine.'
    },
    {
        cle: 'VOLUME_MIN_ALERTE', defaut: 10,
        min: 1, entier: true,
        aide: 'En dessous de ce nombre de messages en 24 h, un domaine ne déclenche pas d\'alerte '
            + 'de conformité : 1 échec sur 3 messages n\'est pas une tendance.'
    },
    {
        cle: 'JOURS_SANS_RAPPORT_ALERTE', defaut: 3,
        min: 1, entier: true,
        aide: 'Alerte si aucun rapport n\'a été reçu pour un domaine de l\'onglet Domaines depuis ce '
            + 'nombre de jours : DNS supprimé, adresse rua cassée… Les émetteurs envoient en général un '
            + 'rapport par jour ; 3 laisse passer un week-end.'
    },
    {
        cle: 'JOURS_RETENTION', defaut: 180,
        min: 30, entier: true,
        aide: 'La purge (menu DMARC) retire du classeur les rapports terminés depuis plus de ce '
            + 'nombre de jours, après les avoir archivés en CSV dans Drive. Borne aussi les choix du '
            + 'filtre Période du tableau de bord. Minimum 30.'
    },
    {
        cle: 'SEUIL_PRET_REJECT', defaut: 0.99,
        min: 0.01, max: 1,
        aide: 'Diagnostic du tableau de bord : au-dessus de ce taux, p=reject est envisageable '
            + 'pour le domaine choisi, après revue des sources non conformes.'
    },
    {
        cle: 'SEUIL_PRET_QUARANTINE', defaut: 0.95,
        min: 0.01, max: 1,
        aide: 'Diagnostic du tableau de bord : au-dessus de ce taux (et sous le précédent), '
            + 'p=quarantine est envisageable.'
    }
]);

const ENTETES_PARAMETRES = Object.freeze(['cle', 'valeur', 'explication']);

const valeurValide_ = (p, v) => Number.isFinite(v) && v >= p.min
    && (p.max === undefined || v <= p.max) && (!p.entier || Number.isInteger(v));

/**
 * Validation de données de la cellule : la saisie hors bornes est refusée à la
 * frappe. Sans elle, le code écartait une valeur invalide mais le tableau de
 * bord, qui lit la cellule par VLOOKUP, l'employait telle quelle — 95 au lieu
 * de 0,95 rendait tous les domaines 🔴.
 */
const validationParametre_ = (p) => {
    const regle = SpreadsheetApp.newDataValidation().setAllowInvalid(false);
    const texte = p.max === undefined ? `un nombre ≥ ${p.min}` : `un nombre entre ${p.min} et ${p.max}`;
    return (p.max === undefined
        ? regle.requireNumberGreaterThanOrEqualTo(p.min)
        : regle.requireNumberBetween(p.min, p.max))
        .setHelpText(`${p.cle} : ${texte}${p.entier ? ', entier' : ''}.`)
        .build();
};

/**
 * Lit l'onglet « Paramètres », en le créant ou en le complétant au besoin.
 * Rend `{ valeurs, avertissements }` : `valeurs` a toujours toutes les clés.
 */
const lireParametres_ = (ss) => {
    const sh = feuille_(ss, CONFIG_DMARC.ONGLET_PARAMETRES, ENTETES_PARAMETRES);
    const entetes = sh.getRange(1, 1, 1, ENTETES_PARAMETRES.length).getValues()[0].map(String);
    const colCle = entetes.indexOf('cle');
    const colValeur = entetes.indexOf('valeur');
    if (colCle < 0 || colValeur < 0) {
        throw new Error(`L'onglet « ${CONFIG_DMARC.ONGLET_PARAMETRES} » a perdu ses en-têtes `
            + '« cle » et « valeur » : rétablissez-les en ligne 1.');
    }

    const n = sh.getLastRow() - 1;
    const saisies = new Map();
    if (n > 0) {
        sh.getRange(2, 1, n, entetes.length).getValues().forEach((ligne) => {
            const cle = String(ligne[colCle]).trim();
            if (cle) saisies.set(cle, ligne[colValeur]);
        });
    }

    // Seules les clés absentes sont ajoutées, avec leur valeur par défaut.
    const manquantes = PARAMETRES_DMARC.filter(p => !saisies.has(p.cle));
    if (manquantes.length) {
        const premiere = sh.getLastRow() + 1;
        ajouterLignes_(sh, manquantes.map(p => {
            const ligne = ENTETES_PARAMETRES.map(() => '');
            ligne[colCle] = p.cle;
            ligne[colValeur] = p.defaut;
            ligne[entetes.indexOf('explication')] = p.aide;
            return ligne;
        }));
        manquantes.forEach((p, i) => {
            saisies.set(p.cle, p.defaut);
            sh.getRange(premiere + i, colValeur + 1).setDataValidation(validationParametre_(p));
        });
    }

    const valeurs = {};
    const avertissements = [];
    PARAMETRES_DMARC.forEach((p) => {
        const brute = saisies.get(p.cle);
        const v = typeof brute === 'number' ? brute : Number(String(brute).replace(',', '.').trim());
        if (brute !== '' && valeurValide_(p, v)) {
            valeurs[p.cle] = v;
        } else {
            valeurs[p.cle] = p.defaut;
            avertissements.push(`Paramètre ${p.cle} invalide (« ${brute} ») : valeur par défaut `
                + `${p.defaut} appliquée. Corrigez-le dans l'onglet « ${CONFIG_DMARC.ONGLET_PARAMETRES} ».`);
        }
    });
    return { valeurs, avertissements };
};
