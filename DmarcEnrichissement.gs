/**
 * DMARC — nom d'hôte des IP sources (DNS inverse vérifié) et opérateur reconnu.
 * Introduit en v1.2.0.
 *
 * Le nom d'hôte inverse (PTR) d'une IP est choisi par qui détient l'IP : un
 * attaquant donne au sien le nom `mail.google.com` s'il le veut. On ne le
 * croit donc que s'il est **confirmé dans l'autre sens** — le nom doit résoudre
 * vers cette même IP (FCrDNS). Sinon, il s'affiche comme « non vérifié » et
 * n'est rattaché à aucun opérateur : une étiquette « Google » sur une source
 * frauduleuse inviterait à l'ignorer.
 *
 * Le résultat vit dans l'onglet masqué `_CacheIP`, que le tableau de bord lit
 * par formule : l'affichage suit l'IP de chaque ligne, quel que soit le filtre.
 */

const TYPES_DNS_DMARC = Object.freeze({ A: 1, PTR: 12, AAAA: 28 });

const ENTETES_CACHE_IP = Object.freeze(['ip', 'affichage', 'statut', 'hote', 'operateur', 'mis_a_jour']);

/**
 * Développe une IPv6 en 32 chiffres hexadécimaux, ou rend null.
 * Les formes à IPv4 incluse (`::ffff:1.2.3.4`) ne sont pas prises en charge.
 */
const developperIpv6_ = (ip) => {
    const s = String(ip || '').trim().toLowerCase();
    if (!/^[0-9a-f:]+$/.test(s) || s.split('::').length > 2) return null;
    const [gauche, droite = ''] = s.split('::');
    const g = gauche ? gauche.split(':') : [];
    const d = droite ? droite.split(':') : [];
    const compresse = s.includes('::');
    const manque = 8 - g.length - d.length;
    if (compresse ? manque < 1 : manque !== 0) return null;
    const groupes = [...g, ...Array(compresse ? manque : 0).fill('0'), ...d];
    if (groupes.some(x => !/^[0-9a-f]{1,4}$/.test(x))) return null;
    return groupes.map(x => x.padStart(4, '0')).join('');
};

const estIpv4_ = ip => {
    const parties = String(ip || '').trim().split('.');
    return parties.length === 4 && parties.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255);
};

/** Nom à interroger pour le PTR d'une IP (in-addr.arpa ou ip6.arpa), ou null. */
const inverserIpPourPtr_ = (ip) => {
    if (estIpv4_(ip)) return `${String(ip).trim().split('.').reverse().join('.')}.in-addr.arpa`;
    const v6 = developperIpv6_(ip);
    return v6 ? `${v6.split('').reverse().join('.')}.ip6.arpa` : null;
};

/** Deux écritures de la même IP ? (IPv6 comparées sous forme développée.) */
const memeIp_ = (a, b) => {
    if (estIpv4_(a) || estIpv4_(b)) return String(a).trim() === String(b).trim();
    const x = developperIpv6_(a);
    return x !== null && x === developperIpv6_(b);
};

/** Opérateur reconnu d'après un nom d'hôte vérifié, ou '' s'il n'est pas dans la liste. */
const identifierOperateur_ = (hote) => {
    const nom = String(hote || '').replace(/\.$/, '').toLowerCase();
    const trouve = OPERATEURS_CONNUS_DMARC.find(op => op.motif.test(nom));
    return trouve ? trouve.nom : '';
};

/**
 * Une requête DNS-over-HTTPS.
 * Rend `{ statut: 'ok', reponses }`, `{ statut: 'absent' }` (le nom n'existe
 * pas ou n'a pas d'enregistrement de ce type) ou `{ statut: 'erreur' }`.
 * Une panne n'est jamais confondue avec une absence : la première se retente,
 * la seconde est un fait qui se met en cache.
 */
const requeteDoH_ = (nom, type) => {
    try {
        const reponse = UrlFetchApp.fetch(
            `${CONFIG_DMARC.DOH_URL}?name=${encodeURIComponent(nom)}&type=${type}`,
            { muteHttpExceptions: true, headers: { Accept: 'application/dns-json' } });
        if (reponse.getResponseCode() !== 200) return { statut: 'erreur' };
        const json = JSON.parse(reponse.getContentText());
        if (json.Status === 3) return { statut: 'absent' };      // NXDOMAIN
        if (json.Status !== 0) return { statut: 'erreur' };      // SERVFAIL, REFUSED…
        const reponses = (json.Answer || [])
            .filter(r => r.type === TYPES_DNS_DMARC[type])
            .map(r => String(r.data || '').replace(/\.$/, '').trim())
            .filter(Boolean);
        return reponses.length ? { statut: 'ok', reponses } : { statut: 'absent' };
    } catch (e) {
        console.error(`Requête DNS ${type} ${nom} : ${e}`);
        return { statut: 'erreur' };
    }
};

/**
 * Résout une IP : PTR, puis confirmation du nom vers l'IP.
 * Rend `{ statut, hote, operateur }` avec statut parmi 'confirme',
 * 'non_confirme', 'absent', 'non_gere', 'erreur'.
 */
const resoudreIp_ = (ip) => {
    const nomPtr = inverserIpPourPtr_(ip);
    if (!nomPtr) return { statut: 'non_gere', hote: '', operateur: '' };

    const ptr = requeteDoH_(nomPtr, 'PTR');
    if (ptr.statut !== 'ok') return { statut: ptr.statut, hote: '', operateur: '' };

    const hote = ptr.reponses[0].toLowerCase();
    const retour = requeteDoH_(hote, estIpv4_(ip) ? 'A' : 'AAAA');
    if (retour.statut === 'erreur') return { statut: 'erreur', hote, operateur: '' };

    const confirme = retour.statut === 'ok' && retour.reponses.some(a => memeIp_(a, ip));
    return confirme
        ? { statut: 'confirme', hote, operateur: identifierOperateur_(hote) }
        : { statut: 'non_confirme', hote, operateur: '' };
};

/** Texte affiché dans le tableau de bord pour une résolution. */
const affichageIp_ = ({ statut, hote, operateur }) => ({
    confirme: operateur ? `${operateur} — ${hote}` : `${hote} (vérifié)`,
    non_confirme: `NON VÉRIFIÉ : ${hote} ne renvoie pas vers cette IP`,
    absent: 'Aucun nom d\'hôte (pas de PTR)',
    non_gere: 'Format d\'IP non pris en charge'
}[statut] || '');

/** Cache en mémoire : Map ip → ligne de `_CacheIP`, entrées expirées écartées. */
const chargerCacheIp_ = (ss, maintenant = Date.now()) => {
    const cache = new Map();
    const sh = ss.getSheetByName(CONFIG_DMARC.ONGLET_CACHE_IP);
    if (!sh || sh.getLastRow() < 2) return cache;

    const entetes = sh.getRange(1, 1, 1, ENTETES_CACHE_IP.length).getValues()[0].map(String);
    // Un cache d'une autre forme (ébauche antérieure) est simplement ignoré :
    // il sera réécrit au format courant.
    if (ENTETES_CACHE_IP.some((e, i) => entetes[i] !== e)) return cache;

    const limite = maintenant - CONFIG_DMARC.JOURS_VALIDITE_CACHE_IP * UN_JOUR_MS_DMARC;
    sh.getRange(2, 1, sh.getLastRow() - 1, ENTETES_CACHE_IP.length).getValues().forEach((l) => {
        const [ip, , statut, , , misAJour] = l;
        if (ip && statut && estDate_(misAJour) && misAJour.getTime() >= limite) cache.set(String(ip), l);
    });
    return cache;
};

/**
 * Réécrit `_CacheIP` en entier, une ligne par IP.
 * Ajouter en fin d'onglet laissait des doublons, et `VLOOKUP` rendait la plus
 * ancienne entrée. Écriture d'abord, effacement de la fin ensuite.
 */
const enregistrerCacheIp_ = (ss, cache) => {
    const sh = feuille_(ss, CONFIG_DMARC.ONGLET_CACHE_IP, ENTETES_CACHE_IP);
    sh.getRange(1, 1, 1, ENTETES_CACHE_IP.length).setValues([[...ENTETES_CACHE_IP]]);
    const lignes = [...cache.values()];
    const ancien = sh.getLastRow() - 1;
    if (lignes.length) {
        sh.getRange(2, 1, lignes.length, ENTETES_CACHE_IP.length).setValues(lignes.map(l => l.map(celluleTexte_)));
    }
    if (ancien > lignes.length) {
        sh.getRange(lignes.length + 2, 1, ancien - lignes.length, ENTETES_CACHE_IP.length).clearContent();
    }
    sh.hideSheet();
};

/**
 * Résout les IP du « Top 15 des sources non conformes » absentes du cache.
 *
 * Seules les erreurs ne sont pas mises en cache : elles sont retentées au
 * passage suivant. Rend le nombre d'IP résolues.
 */
const enrichirTopSourcesNonConformes_ = (ss, maintenant = Date.now()) => {
    const tdb = ss.getSheetByName(TABLEAU_DMARC.FEUILLE);
    if (!tdb) return 0;

    const ips = tdb.getRange(TABLEAU_DMARC.LIGNE_TOP_SOURCES, 3, 15, 1).getValues()
        .map(r => String(r[0]).trim())
        .filter(ip => estIpv4_(ip) || developperIpv6_(ip));
    if (!ips.length) return 0;

    const cache = chargerCacheIp_(ss, maintenant);
    const aResoudre = [...new Set(ips)].filter(ip => !cache.has(ip)).slice(0, CONFIG_DMARC.MAX_RESOLUTIONS_IP);
    let resolues = 0;
    aResoudre.forEach((ip) => {
        const r = resoudreIp_(ip);
        if (r.statut === 'erreur') return;
        cache.set(ip, [ip, affichageIp_(r), r.statut, r.hote, r.operateur, new Date(maintenant)]);
        resolues++;
    });
    if (resolues) enregistrerCacheIp_(ss, cache);
    return resolues;
};
