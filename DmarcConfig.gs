/**
 * DMARC — configuration et constantes partagées.
 * Introduit en v1.0.0.
 *
 * Les noms globaux portent tous le suffixe ou le préfixe DMARC : deux fichiers
 * d'un même projet qui déclarent la même constante empêchent le projet entier
 * de se charger, et toutes les fonctions deviennent « introuvables » d'un coup.
 * Un `CONFIG` nu est le premier candidat à la collision.
 */

/** Seul numéro de version courant du projet ; le banc vérifie qu'il vaut le fichier VERSION. */
const VERSION_DMARC = '1.7.2';

const CONFIG_DMARC = Object.freeze({
    COMPTE_TECHNIQUE: 'dmarc-bot@example.com',
    // Les adresses de réception des rapports (rua) se règlent dans la colonne
    // `adresse_rua` de l'onglet « Domaines » (DmarcDomaines.gs), depuis la v1.4.0.
    // Clé de stockage dans ScriptProperties (vide = archivage désactivé)
    CLE_DRIVE_FOLDER_ID: 'DRIVE_FOLDER_ID',
    CLE_EMAIL_ALERTE: 'EMAIL_ALERTE',
    CLE_WEBHOOK_ALERTE: 'WEBHOOK_ALERTE',
    ERROR_LABEL: 'DMARC-Erreur',    // libellé pour les fils non traités
    // Libellé des fils dont un rapport vise un domaine absent de l'onglet
    // Domaines : conservés pour examen, jamais mis à la corbeille.
    LABEL_HORS_LISTE: 'DMARC-Hors-liste',
    ONGLET_DOMAINES: 'Domaines',
    ONGLET_JOURNAL: 'Journal',
    ONGLET_AIDE: 'Aide',
    // Au-delà, les plus anciennes lignes du Journal sont retirées.
    MAX_LIGNES_JOURNAL: 500,
    ONGLET_RAPPORTS: 'Rapports',
    ONGLET_ENREG: 'Enregistrements',
    ONGLET_CACHE_IP: '_CacheIP',
    // Seuils d'alerte et durée de rétention : onglet « Paramètres »
    // (DmarcParametres.gs), modifiables sans déploiement.
    ONGLET_PARAMETRES: 'Paramètres',
    // Endpoint DNS-over-HTTPS
    DOH_URL: 'https://dns.google/resolve',
    // Résolutions d'IP par passage (deux requêtes DoH chacune) : borne le
    // temps pris après le traitement des fils.
    MAX_RESOLUTIONS_IP: 15,
    // Un nom d'hôte change : au-delà, l'IP est résolue de nouveau.
    JOURS_VALIDITE_CACHE_IP: 30,
    // Taille d'une page de recherche Gmail. Le traitement enchaîne les pages
    // tant qu'il reste du temps : ce n'est plus un plafond par exécution.
    MAX_THREADS: 50,
    MAX_RUNTIME_MS: 5 * 60 * 1000   // marge avant la limite de 6 min
});

/**
 * Opérateurs reconnus d'après un nom d'hôte **vérifié** (voir DmarcEnrichissement.gs).
 *
 * Chaque motif est ancré sur une frontière de label, `(^|\.)` : sans elle,
 * `/outlook\.com$/` reconnaissait aussi `evil-outlook.com`, domaine que
 * n'importe qui peut enregistrer. Les noms disent ce qu'un nom d'hôte prouve :
 * `google.com` sert Gmail comme Workspace, on ne prétend pas trancher.
 */
const OPERATEURS_CONNUS_DMARC = Object.freeze([
    { motif: /(^|\.)(google\.com|googlemail\.com|1e100\.net)$/i, nom: 'Google (Gmail, Workspace)' },
    { motif: /(^|\.)(outlook\.com|microsoft\.com)$/i, nom: 'Microsoft (Outlook, 365)' },
    { motif: /(^|\.)(sendinblue\.com|brevo\.com)$/i, nom: 'Brevo' },
    { motif: /(^|\.)sendgrid\.net$/i, nom: 'SendGrid' },
    { motif: /(^|\.)amazonses\.com$/i, nom: 'Amazon SES' },
    { motif: /(^|\.)(mailchimp\.net|mailchimpapp\.net|mcsv\.net)$/i, nom: 'Mailchimp' },
    { motif: /(^|\.)mailjet\.com$/i, nom: 'Mailjet' },
    { motif: /(^|\.)ovh\.(net|fr|com)$/i, nom: 'OVHcloud' },
    { motif: /(^|\.)postmarkapp\.com$/i, nom: 'Postmark' }
]);

/** Récupère l'ID du dossier d'archivage XML stocké dans ScriptProperties. */
const obtenirDossierArchiveId_ = () => {
    try {
        return (PropertiesService.getScriptProperties().getProperty(CONFIG_DMARC.CLE_DRIVE_FOLDER_ID) || '').trim();
    } catch (e) {
        console.error(`Impossible de lire les propriétés du script : ${e}`);
        return '';
    }
};

/*
 * « cle » (depuis la v1.6.0) : émetteur|report_id, la clé qui distingue deux
 * rapports. Le report_id n'est unique que chez un même émetteur (RFC 7489) :
 * seul, il prenait pour doublon le rapport d'un second émetteur, et joignait
 * ses lignes au rapport du premier. Toujours en DERNIÈRE colonne, pour que
 * les colonnes existantes — et les formules qui les lisent — ne bougent pas.
 *
 * « dkim_diag » (depuis la v1.7.0) : DKIM valide, cassé, d'un tiers ou absent
 * (voir diagnosticDkim_). Même règle : ajoutée à la fin.
 */
const ENTETES_RAPPORTS = Object.freeze([
    'report_id', 'org_name', 'org_email', 'date_debut', 'date_fin',
    'domaine', 'adkim', 'aspf', 'p', 'sp', 'pct', 'fichier', 'traite_le', 'cle'
]);

const ENTETES_ENREG = Object.freeze([
    'report_id', 'domaine', 'source_ip', 'count', 'disposition', 'dkim_eval',
    'spf_eval', 'header_from', 'envelope_from', 'dkim_domaines', 'dkim_resultats',
    'spf_domaines', 'spf_resultats', 'cle', 'dkim_diag'
]);

const TABLEAU_DMARC = Object.freeze({
    FEUILLE: 'Tableau de bord',
    DONNEES: '_Données',
    // Le tableau « Conformité par domaine » occupe les lignes 13 à 42 : au-delà,
    // la requête déborderait sur la section suivante et Sheets rendrait une
    // erreur que IFERROR maquillerait en « Aucune donnée ».
    MAX_DOMAINES: 30,
    // Première ligne de données du « Top 15 des sources non conformes » :
    // DmarcEnrichissement.gs y lit les IP à résoudre.
    LIGNE_TOP_SOURCES: 47
});
