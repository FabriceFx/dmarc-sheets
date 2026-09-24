/**
 * DMARC — onglet « Journal » : le bilan de chaque passage, lisible sans ouvrir Apps Script.
 * Introduit en v1.3.0.
 *
 * Le bilan d'un passage horaire n'allait qu'au journal d'exécution : « alerte
 * non transmise », « paramètre invalide », « verrou occupé » restaient
 * invisibles de qui ne lance pas le traitement à la main. Chaque passage
 * laisse ici une ligne, et le tableau de bord affiche l'heure du dernier.
 */

const ENTETES_JOURNAL = Object.freeze(['horodatage', 'origine', 'bilan']);

/**
 * Ajoute une ligne au Journal et le borne à `MAX_LIGNES_JOURNAL`.
 *
 * `appendRow` plutôt que `getLastRow() + 1` : l'ajout est atomique, et le
 * journal s'écrit aussi quand le verrou est tenu par un autre passage.
 * Ne lève jamais : un journal en panne ne doit pas faire échouer ce qu'il
 * raconte.
 */
const journaliser_ = (ss, origine, texte) => {
    try {
        const sh = feuille_(ss, CONFIG_DMARC.ONGLET_JOURNAL, ENTETES_JOURNAL);
        // La version accompagne l'origine : un script lié tourne sur le code
        // présent dans l'éditeur, et le Journal est l'endroit où l'on se demande
        // quel code a produit tel bilan.
        sh.appendRow([new Date(), `${origine} · v${VERSION_DMARC}`, texte].map(celluleTexte_));
        const exces = sh.getLastRow() - 1 - CONFIG_DMARC.MAX_LIGNES_JOURNAL;
        if (exces > 0) sh.deleteRows(2, exces);
    } catch (e) {
        console.error(`Journal indisponible : ${e}`);
    }
};

/** Origine d'un appel : un déclencheur passe un événement portant `triggerUid`. */
const origineAppel_ = e => (e && e.triggerUid ? 'déclencheur horaire' : 'menu');
