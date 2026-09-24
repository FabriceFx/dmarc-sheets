/**
 * DMARC — onglet « Aide » : comprendre DMARC et l'outil sans quitter le classeur.
 * Introduit en v1.5.0.
 *
 * Le guide complet (COMPRENDRE-DMARC.md) vit dans le dépôt, hors de portée de
 * qui n'a que le classeur. Cet onglet en donne l'essentiel, plus ce que le
 * guide ne peut pas dire sur place : à quoi sert chaque onglet, ce que
 * signifient les libellés Gmail, que faire au quotidien.
 *
 * Uniquement des valeurs, aucune formule : l'onglet s'affiche à l'identique
 * quelle que soit la langue du classeur. Il appartient au script et il est
 * régénéré à chaque changement de version : toute retouche manuelle y serait
 * perdue, et c'est voulu — une aide qui décrit un autre code que celui qui
 * tourne est pire que pas d'aide.
 */

/** Cellule où l'onglet note la version qui l'a écrit. */
const CELLULE_VERSION_AIDE = 'C2';

/**
 * Contenu de l'aide : [titre de section, [[intitulé, explication], …]].
 * Les noms d'onglets et de libellés viennent de la configuration : renommer
 * un onglet dans le code renomme aussi son explication.
 */
const contenuAide_ = () => {
    const c = CONFIG_DMARC;
    const t = TABLEAU_DMARC;
    return [
        ['À quoi sert cet outil', [
            ['En une phrase', 'Chaque jour, les grands destinataires (Google, Microsoft, Yahoo…) envoient un rapport '
                + 'sur tous les e-mails qu\'ils ont reçus au nom de vos domaines. Cet outil relève ces rapports, '
                + 'les range dans ce classeur et en tire un tableau de bord et des alertes.'],
            ['Pourquoi c\'est utile', 'Un e-mail ne prouve pas qui l\'envoie : n\'importe qui peut écrire '
                + '« From: direction@votre-domaine ». Les rapports montrent qui envoie en votre nom, légitimement '
                + 'ou non, et vous permettent de bloquer les usurpations sans bloquer vos propres envois.']
        ]],
        ['Les trois mécanismes', [
            ['Deux expéditeurs', 'Un e-mail porte une adresse d\'ENVELOPPE, technique et invisible, et une adresse '
                + 'VISIBLE (l\'en-tête From:). Elles diffèrent souvent quand un prestataire envoie pour vous.'],
            ['SPF', 'Liste, publiée dans le DNS, des serveurs autorisés à envoyer pour un domaine. Il vérifie '
                + 'l\'adresse d\'enveloppe seulement. Il échoue quand un message est transféré automatiquement.'],
            ['DKIM', 'Signature cryptographique apposée par le serveur d\'envoi, vérifiable grâce à une clé publiée '
                + 'dans le DNS. Elle survit au transfert, mais pas à une modification du message (listes de diffusion).'],
            ['DMARC', 'Exige que le domaine vérifié par SPF ou DKIM corresponde au domaine de l\'adresse VISIBLE : '
                + 'c\'est l\'alignement. Il indique aussi aux destinataires quoi faire en cas d\'échec (politique p=) '
                + 'et où envoyer les rapports (rua=).'],
            ['Conforme DMARC', 'DKIM passe ET est aligné, OU SPF passe ET est aligné. Un seul des deux suffit. '
                + 'C\'est la définition du « taux de conformité » du tableau de bord.'],
            ['Les politiques', 'p=none : observer seulement (on commence toujours par là). p=quarantine : '
                + 'mettre en indésirables. p=reject : refuser. Seules les deux dernières protègent réellement.']
        ]],
        [`Lire l'onglet « ${t.FEUILLE} »`, [
            ['Filtres (C4, C5)', 'Choisissez un domaine et une période : tout le tableau se recalcule.'],
            ['Taux de conformité', 'La part des messages conformes. C\'est le chiffre à faire monter.'],
            ['Taux DKIM / SPF', 'Lequel des deux mécanismes porte la conformité. Un taux DKIM bas signale '
                + 'souvent un prestataire qui ne signe pas à votre nom.'],
            ['Non conformes non rejetés', 'Ce que votre politique actuelle laisse encore passer.'],
            ['Top 15 des sources', 'Qui envoie en votre nom sans être en règle : votre liste de travail.'],
            ['Signature DKIM', 'Pour chaque message non conforme : « DKIM cassé » (signé par votre domaine puis '
                + 'modifié en route : légitime très probablement, rejeté à cause d\'un intermédiaire du '
                + 'destinataire), « DKIM d\'un tiers » (à examiner), « DKIM absent » (usurpation probable), « DKIM non '
                + 'renseigné » (l\'émetteur du rapport ne détaille pas DKIM : on ne peut pas trancher).'],
            ['Nom d\'hôte vérifié', 'À qui appartient l\'IP, quand on peut le confirmer. « NON VÉRIFIÉ » : le nom '
                + 'affiché ne pointe pas vers cette IP, ne vous y fiez pas.'],
            ['Diagnostic', 'Une indication pour le domaine choisi, pas un verdict : relisez le Top 15 avant de '
                + 'durcir la politique.'],
            ['Survol', 'Chaque intitulé du tableau de bord porte une note qui explique son calcul.']
        ]],
        ['Que faire d\'une source non conforme', [
            ['1. Service que vous utilisez ?', 'Lettre d\'information, facturation, CRM, support, imprimante… '
                + 'Activez chez ce prestataire la signature DKIM à VOTRE nom de domaine (le plus solide), ou ajoutez-le '
                + 'à votre SPF.'],
            ['2. Transfert ou liste ?', 'Faible volume, hébergeurs de messagerie : échecs normaux, sur lesquels vous '
                + 'n\'avez guère de prise. Ils expliquent qu\'on atteigne rarement 100 %.'],
            ['3. Inconnue, en volume ?', 'Probablement une usurpation : c\'est ce que p=reject bloquera.']
        ]],
        ['Le parcours type', [
            ['Étape 1', 'Publier p=none avec une adresse rua, et laisser venir les rapports 2 à 4 semaines.'],
            ['Étape 2', 'Mettre en règle les sources légitimes du Top 15.'],
            ['Étape 3', 'Passer à p=quarantine, éventuellement progressivement avec pct=.'],
            ['Étape 4', 'Passer à p=reject, et continuer à lire les rapports.']
        ]],
        ['Les onglets de ce classeur', [
            [t.FEUILLE, 'Indicateurs, sources non conformes, graphiques.'],
            [c.ONGLET_DOMAINES, 'VOS RÉGLAGES : adresses de réception des rapports (colonne adresse_rua), domaines '
                + 'dont les rapports sont acceptés (colonne domaine) et, facultatif, sélecteurs DKIM de chaque domaine '
                + '(colonne selecteurs_dkim) pour le contrôle DNS. Sans adresse, rien n\'est relevé.'],
            [c.ONGLET_PARAMETRES, 'VOS RÉGLAGES : seuils d\'alerte, durée de conservation, seuils du diagnostic. '
                + 'Chaque ligne explique son effet ; une valeur hors bornes est refusée à la saisie.'],
            [c.ONGLET_JOURNAL, 'Le bilan de chaque passage, le plus récent en bas. Le premier endroit où regarder '
                + 'quand quelque chose semble ne pas marcher.'],
            [c.ONGLET_RAPPORTS, 'Une ligne par rapport reçu. Rempli par le script : ne pas modifier. La dernière '
                + 'colonne, « cle » (émetteur|identifiant), distingue deux rapports : deux émetteurs peuvent '
                + 'employer le même identifiant.'],
            [c.ONGLET_ENREG, 'Une ligne par groupe de messages (IP source × résultat). Rempli par le script : '
                + 'ne pas modifier.'],
            [t.DONNEES, 'Onglet masqué : les calculs du tableau de bord. Ne pas supprimer.'],
            [c.ONGLET_DNS, 'Le contrôle des enregistrements DMARC, SPF et DKIM de chaque domaine, refait chaque '
                + 'jour et à la demande (menu DMARC > Contrôler les enregistrements DNS). Un statut par point : OK, '
                + 'Info, Attention, Problème ; « Non vérifié » quand le DNS n\'a pas répondu.'],
            [c.ONGLET_CACHE_IP, 'Onglet masqué : les noms d\'hôte déjà résolus, gardés '
                + `${c.JOURS_VALIDITE_CACHE_IP} jours.`],
            [c.ONGLET_AIDE, 'Cet onglet. Régénéré par le script à chaque nouvelle version : vos modifications y seraient '
                + 'perdues.']
        ]],
        ['Dans Gmail (compte technique)', [
            [c.ERROR_LABEL, 'Fil que le script n\'a pas su lire entièrement (souvent un rapport forensique ou une '
                + 'notification). Ses rapports lisibles sont déjà enregistrés. Examinez-le, puis retirez le libellé '
                + 'pour le relancer, ou supprimez le fil.'],
            [c.LABEL_HORS_LISTE, `Fil dont un rapport vise un domaine absent de l'onglet « ${c.ONGLET_DOMAINES} ». `
                + 'Rien n\'en a été enregistré. Si c\'est votre domaine : ajoutez-le à l\'onglet, puis retirez '
                + 'le libellé.']
        ]],
        ['Au quotidien', [
            ['Tout va bien si…', '« Dernier passage », en tête du tableau de bord, date de moins d\'une heure, et le '
                + 'Journal ne signale ni échec ni alerte non transmise.'],
            ['Une alerte arrive', 'Choisissez le domaine en C4 du tableau de bord et lisez le Top 15.'],
            ['Alerte de silence', 'Aucun rapport depuis plusieurs jours : vérifiez l\'enregistrement DNS _dmarc '
                + '(rua=) et l\'acheminement de l\'adresse de réception.'],
            ['Quelle version tourne ?', 'Menu DMARC > À propos, ou la case en haut de cet onglet.']
        ]],
        ['Pour aller plus loin', [
            ['Guide complet', 'COMPRENDRE-DMARC.md, dans le dépôt du projet : exemples d\'enregistrements DNS, '
                + 'rapport commenté, pièges fréquents, glossaire.'],
            ['Références', 'RFC 7489 (DMARC), RFC 7208 (SPF), RFC 6376 (DKIM), dmarc.org.'],
            ['Auteur', `${PRODUIT_DMARC.AUTEUR} — ${PRODUIT_DMARC.SITE}`]
        ]]
    ];
};

/**
 * (Re)construit l'onglet Aide. Rend l'onglet.
 * Des valeurs seulement, écrites en un bloc par section.
 */
const construireAide_ = (ss) => {
    const existant = ss.getSheetByName(CONFIG_DMARC.ONGLET_AIDE);
    if (existant) ss.deleteSheet(existant);
    const sh = ss.insertSheet(CONFIG_DMARC.ONGLET_AIDE);

    sh.setHiddenGridlines(true);
    [[1, 20], [2, 240], [3, 720]].forEach(([col, largeur]) => sh.setColumnWidth(col, largeur));
    sh.getRange('B1').setValue('Aide — comprendre DMARC et cet outil').setFontSize(18).setFontWeight('bold');
    sh.getRange('B2').setValue('Version de l\'outil :').setFontColor('#666666');
    sh.getRange(CELLULE_VERSION_AIDE).setValue(celluleTexte_(`v${VERSION_DMARC}`)).setFontColor('#666666');
    sh.getRange('B3').setValue('Cet onglet est régénéré par le script à chaque nouvelle version : '
        + 'ne le modifiez pas, vos changements seraient perdus.').setFontColor('#888888').setFontSize(9);

    let ligne = 5;
    contenuAide_().forEach(([titre, lignes]) => {
        sh.getRange(ligne, 2).setValue(titre).setFontSize(12).setFontWeight('bold');
        sh.getRange(ligne, 2, 1, 2).setBackground('#e8eaed');
        ligne += 1;
        sh.getRange(ligne, 2, lignes.length, 2)
            .setValues(lignes.map(l => l.map(celluleTexte_)))
            .setWrap(true).setVerticalAlignment('top');
        sh.getRange(ligne, 2, lignes.length, 1).setFontWeight('bold');
        ligne += lignes.length + 1;
    });
    return sh;
};

/**
 * Régénère l'aide si elle manque ou si elle a été écrite par une autre version.
 * Appelé à chaque passage horaire : une lecture d'une cellule quand tout est à jour.
 */
const mettreAJourAideSiNecessaire_ = (ss) => {
    const sh = ss.getSheetByName(CONFIG_DMARC.ONGLET_AIDE);
    if (sh && String(sh.getRange(CELLULE_VERSION_AIDE).getValues()[0][0]) === `v${VERSION_DMARC}`) return false;
    construireAide_(ss);
    return true;
};

/** Menu DMARC > Aide : ouvre l'onglet, en le (re)créant au besoin. */
function afficherAide() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    try {
        mettreAJourAideSiNecessaire_(ss);
        ss.setActiveSheet(ss.getSheetByName(CONFIG_DMARC.ONGLET_AIDE));
    } catch (e) {
        console.error(`Aide : ${e}`);
        SpreadsheetApp.getUi().alert(`Impossible d'afficher l'aide : ${e.message || e}`);
    }
}
