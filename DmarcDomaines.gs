/**
 * DMARC — onglet « Domaines » : les domaines dont on accepte les rapports.
 * Introduit en v1.3.0.
 *
 * L'adresse rua est publique et un rapport DMARC n'est pas authentifié :
 * n'importe qui peut en envoyer un pour un domaine inventé, ou pour l'un des
 * nôtres avec des volumes fictifs. Ce filtre ne rend pas les chiffres
 * authentiques — rien ne le peut —, mais il ferme la porte aux domaines
 * inventés, qui sinon entraient dans le tableau de bord et les alertes.
 *
 * Un rapport pour un domaine absent de la liste n'est pas enregistré ; son fil
 * reçoit le libellé « DMARC-Hors-liste » et n'est jamais mis à la corbeille.
 * Si le domaine était légitime, rien n'est perdu : on l'ajoute à l'onglet,
 * on retire le libellé, le fil est retraité.
 */

const ENTETES_DOMAINES = Object.freeze(['domaine', 'adresse_rua', 'commentaire']);

/** Largeur lue pour chercher les en-têtes : l'ordre des colonnes peut changer. */
const LARGEUR_ENTETES_DOMAINES = 10;

/**
 * Adresse de réception acceptable. Plus stricte qu'un simple contrôle de
 * forme : les adresses entrent telles quelles dans la requête Gmail, et une
 * cellule `x@y.fr OR in:anywhere` élargirait la recherche à toute la boîte.
 * Ni espace, ni accolade, ni parenthèse, ni guillemet.
 */
const ADRESSE_RUA_VALIDE = /^[^\s@{}()"]+@[^\s@{}()"]+\.[^\s@{}()"]+$/;

/**
 * Complète la ligne d'en-têtes sans rien déplacer : une colonne attendue et
 * absente (onglet créé par une version antérieure) est ajoutée après la
 * dernière. Rend les en-têtes relus.
 */
const completerEntetesDomaines_ = (sh) => {
    const lire = () => sh.getRange(1, 1, 1, LARGEUR_ENTETES_DOMAINES).getValues()[0]
        .map(e => String(e).trim());
    const entetes = lire();
    const manquants = ENTETES_DOMAINES.filter(e => !entetes.includes(e));
    if (!manquants.length) return entetes;
    const derniere = entetes.reduce((d, e, i) => (e ? i + 1 : d), 0);
    sh.getRange(1, derniere + 1, 1, manquants.length).setValues([manquants]);
    return lire();
};

/**
 * Lit l'onglet « Domaines », en le créant au besoin.
 * Rend `{ domaines, adresses, avertissements }`.
 *
 * À la création, il est prérempli avec les domaines déjà présents dans
 * l'onglet Rapports, marqués « à vérifier » : sans cela, la mise à jour
 * écarterait du jour au lendemain tous les rapports d'une installation
 * existante. Liste de domaines vide = filtrage désactivé, et le bilan le dit.
 *
 * Les adresses de réception (colonne `adresse_rua`) vivaient dans le code
 * jusqu'à la v1.3.0 ; elles se règlent ici sans déploiement. Une cellule peut
 * en porter plusieurs, séparées par des virgules ou des points-virgules.
 */
const lireOngletDomaines_ = (ss) => {
    let sh = ss.getSheetByName(CONFIG_DMARC.ONGLET_DOMAINES);
    if (!sh) {
        sh = feuille_(ss, CONFIG_DMARC.ONGLET_DOMAINES, ENTETES_DOMAINES);
        const rap = ss.getSheetByName(CONFIG_DMARC.ONGLET_RAPPORTS);
        const colDomaine = ENTETES_RAPPORTS.indexOf('domaine') + 1;
        const connus = rap && rap.getLastRow() > 1
            ? [...new Set(rap.getRange(2, colDomaine, rap.getLastRow() - 1, 1).getValues()
                .map(([d]) => String(d).trim().toLowerCase()).filter(Boolean))].sort()
            : [];
        ajouterLignes_(sh, connus.map(d => [d, '', 'repris des rapports existants — à vérifier']));
    }

    const entetes = completerEntetesDomaines_(sh);
    const colDomaine = entetes.indexOf('domaine');
    const colAdresse = entetes.indexOf('adresse_rua');
    if (colDomaine < 0) {
        throw new Error(`L'onglet « ${CONFIG_DMARC.ONGLET_DOMAINES} » a perdu son en-tête « domaine » : `
            + 'rétablissez-le en ligne 1.');
    }

    const n = sh.getLastRow() - 1;
    const lignes = n > 0 ? sh.getRange(2, 1, n, entetes.length).getValues() : [];
    const domaines = new Set(lignes
        .map(l => String(l[colDomaine]).trim().toLowerCase().replace(/\.$/, '')).filter(Boolean));

    const adresses = new Set();
    const avertissements = [];
    lignes.forEach((l) => {
        String(l[colAdresse]).split(/[,;]/).map(a => a.trim().toLowerCase()).filter(Boolean).forEach((a) => {
            if (ADRESSE_RUA_VALIDE.test(a)) adresses.add(a);
            else avertissements.push(`Adresse de réception ignorée (« ${a} ») : ce n'est pas une adresse `
                + `valide. Corrigez-la dans l'onglet « ${CONFIG_DMARC.ONGLET_DOMAINES} ».`);
        });
    });
    return { domaines, adresses: [...adresses].sort(), avertissements };
};

/**
 * Le domaine publié dans un rapport est-il surveillé ?
 * Un sous-domaine d'un domaine listé l'est aussi (politique `sp=`).
 */
const domaineSurveille_ = (domaine, domaines) => {
    const d = String(domaine || '').trim().toLowerCase().replace(/\.$/, '');
    if (!d) return false;
    return [...domaines].some(x => d === x || d.endsWith(`.${x}`));
};
