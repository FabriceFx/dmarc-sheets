/**
 * DMARC — contrôle des enregistrements DNS de chaque domaine (DMARC, SPF, DKIM).
 * Introduit en v1.8.0.
 *
 * Les rapports disent ce qui s'est passé ; le DNS dit ce que le domaine
 * demande. Ce contrôle relit, pour chaque domaine de l'onglet Domaines, les
 * trois enregistrements qui fondent DMARC, et range dans l'onglet
 * « Contrôle DNS » un constat par point : statut, explication, marche à suivre.
 *
 * Les requêtes passent par le DNS public de Google (requeteDoH_, comme les
 * noms d'hôte). Une panne DNS donne « Non vérifié », jamais « Problème » :
 * un constat ne se donne pas pour plus certain qu'il n'est.
 */

const ENTETES_CONTROLE_DNS = Object.freeze(['domaine', 'element', 'statut', 'constat', 'a_faire',
    'enregistrement', 'verifie_le']);

const STATUTS_DNS = Object.freeze({
    OK: 'OK',
    INFO: 'Info',
    ATTENTION: 'Attention',
    PROBLEME: 'Problème',
    NON_VERIFIE: 'Non vérifié'
});

const COULEURS_STATUT_DNS = Object.freeze({
    'OK': '#b7e1cd',
    'Info': '#d6e4f0',
    'Attention': '#fce8b2',
    'Problème': '#f4c7c3',
    'Non vérifié': '#e0e0e0'
});

/**
 * Sélecteurs DKIM essayés quand l'onglet Domaines n'en indique pas : ceux de
 * Google Workspace, Microsoft 365 et des outils les plus répandus. Un
 * sélecteur est libre ; il se lit dans l'en-tête DKIM-Signature (s=) d'un
 * e-mail envoyé.
 */
const SELECTEURS_DKIM_COURANTS = Object.freeze(['google', 'selector1', 'selector2', 'default', 'dkim',
    'mail', 'k1', 's1', 's2']);

/** Limite de la RFC 7208 : au-delà, le SPF échoue (permerror) chez tous les destinataires. */
const MAX_CONSULTATIONS_SPF = 10;

/** Plafond de requêtes pour suivre les include: d'un SPF : borne le temps passé sur un domaine. */
const MAX_REQUETES_SPF = 30;

const UN_JOUR_MS_DNS = 24 * 60 * 60 * 1000;

const constatDns_ = (domaine, element, statut, constat, aFaire = '', enregistrement = '') =>
    ({ domaine, element, statut, constat, aFaire, enregistrement });

/* ===================== DMARC ===================== */

/** Balises d'un enregistrement DMARC, en minuscules : { v, p, sp, pct, rua, … }. */
const balisesDmarc_ = texte => Object.fromEntries(String(texte).split(';')
    .map(t => t.trim()).filter(Boolean)
    .map((t) => {
        const i = t.indexOf('=');
        return i < 0 ? [t.toLowerCase(), ''] : [t.slice(0, i).trim().toLowerCase(), t.slice(i + 1).trim()];
    }));

/** Adresses d'une balise rua : « mailto:a@b.fr!10m, mailto:c@d.fr » → ['a@b.fr', 'c@d.fr']. */
const adressesRua_ = valeur => String(valeur || '').split(',')
    .map(u => u.trim().replace(/^mailto:/i, '').replace(/!.*$/, '').toLowerCase())
    .filter(a => a.includes('@'));

const controlerDmarc_ = (domaine, adressesOutil) => {
    const r = requeteDoH_(`_dmarc.${domaine}`, 'TXT');
    if (r.statut === 'erreur') {
        return [constatDns_(domaine, 'DMARC', STATUTS_DNS.NON_VERIFIE, 'Le DNS n\'a pas répondu.',
            'Relancer le contrôle plus tard.')];
    }
    const dmarc = (r.reponses || []).filter(t => /^v=dmarc1\s*(;|$)/i.test(t.trim()));
    if (!dmarc.length) {
        return [constatDns_(domaine, 'DMARC', STATUTS_DNS.PROBLEME,
            'Aucun enregistrement DMARC : les destinataires n\'appliquent aucune politique et n\'envoient aucun rapport.',
            `Publier en TXT sur _dmarc.${domaine} : v=DMARC1; p=none; rua=mailto:${adressesOutil[0] || 'votre-adresse'}`)];
    }
    if (dmarc.length > 1) {
        return [constatDns_(domaine, 'DMARC', STATUTS_DNS.PROBLEME,
            `${dmarc.length} enregistrements DMARC : les destinataires ignorent alors DMARC.`,
            'N\'en garder qu\'un seul.', dmarc.join(' | '))];
    }

    const brut = dmarc[0];
    const b = balisesDmarc_(brut);
    const constats = [];
    const p = String(b.p || '').toLowerCase();
    if (!['none', 'quarantine', 'reject'].includes(p)) {
        constats.push(constatDns_(domaine, 'DMARC', STATUTS_DNS.PROBLEME,
            `Politique p= absente ou invalide (« ${b.p || ''} ») : l'enregistrement est ignoré.`,
            'Indiquer p=none, p=quarantine ou p=reject.', brut));
    } else if (p === 'none') {
        constats.push(constatDns_(domaine, 'DMARC', STATUTS_DNS.INFO,
            'Politique p=none : observation seule, les usurpations ne sont pas bloquées.',
            'Une fois les sources légitimes en règle (Top 15 du tableau de bord), passer à p=quarantine puis p=reject.',
            brut));
    } else {
        const pct = b.pct === undefined ? 100 : Number(b.pct);
        constats.push(constatDns_(domaine, 'DMARC', pct < 100 ? STATUTS_DNS.INFO : STATUTS_DNS.OK,
            pct < 100 ? `Politique p=${p}, appliquée à ${pct} % des messages seulement.` : `Politique p=${p}.`,
            pct < 100 ? 'Monter pct à 100 une fois la montée en charge terminée.' : '', brut));
    }

    const rua = adressesRua_(b.rua);
    if (!rua.length) {
        constats.push(constatDns_(domaine, 'DMARC rua', STATUTS_DNS.PROBLEME,
            'Aucune adresse rua : aucun rapport n\'est envoyé, l\'outil ne verra rien pour ce domaine.',
            `Ajouter rua=mailto:${adressesOutil[0] || 'votre-adresse'} à l'enregistrement DMARC.`, brut));
        return constats;
    }
    const suivies = rua.filter(a => adressesOutil.includes(a));
    constats.push(suivies.length
        ? constatDns_(domaine, 'DMARC rua', STATUTS_DNS.OK, `Rapports envoyés à ${suivies.join(', ')}, relevée par l'outil.`,
            '', brut)
        : constatDns_(domaine, 'DMARC rua', STATUTS_DNS.PROBLEME,
            `Les rapports partent vers ${rua.join(', ')}, qu'aucune ligne de l'onglet Domaines ne relève.`,
            'Ajouter l\'une de ces adresses dans la colonne adresse_rua, ou l\'adresse de l\'outil à la balise rua.',
            brut));

    // Une adresse rua dans un autre domaine exige que ce domaine l'autorise
    // (RFC 7489 § 7.1), sinon les émetteurs sérieux n'envoient rien.
    rua.map(a => a.split('@')[1]).filter((d, i, t) => d && t.indexOf(d) === i && !memeDomaine_(d, domaine))
        .forEach((externe) => {
            const nom = `${domaine}._report._dmarc.${externe}`;
            const autorisation = requeteDoH_(nom, 'TXT');
            if (autorisation.statut === 'erreur') {
                constats.push(constatDns_(domaine, 'DMARC rua', STATUTS_DNS.NON_VERIFIE,
                    `Autorisation de ${externe} non vérifiée : le DNS n'a pas répondu.`, 'Relancer le contrôle plus tard.'));
            } else if ((autorisation.reponses || []).some(t => /^v=dmarc1/i.test(t.trim()))) {
                constats.push(constatDns_(domaine, 'DMARC rua', STATUTS_DNS.OK,
                    `${externe} autorise la réception des rapports de ce domaine.`, '', nom));
            } else {
                constats.push(constatDns_(domaine, 'DMARC rua', STATUTS_DNS.PROBLEME,
                    `${externe} n'autorise pas la réception des rapports de ce domaine : les émetteurs ne lui en envoient pas.`,
                    `Publier en TXT sur ${nom} : v=DMARC1`));
            }
        });
    return constats;
};

/* ===================== SPF ===================== */

const estSpf_ = t => /^v=spf1(\s|$)/i.test(String(t).trim());

/**
 * Compte les consultations DNS d'un SPF, include: et redirect= compris
 * (RFC 7208 § 4.6.4 : include, a, mx, ptr, exists, redirect). Approximation
 * assumée : un mx compte pour un, sans les consultations de ses serveurs.
 */
const compterConsultationsSpf_ = (texte, etat) => {
    String(texte).trim().split(/\s+/).slice(1).forEach((terme) => {
        const m = /^([a-z0-9]+)(?:[:=](.*))?$/i.exec(terme.replace(/^[+?~-]/, ''));
        if (!m) return;
        const nom = m[1].toLowerCase();
        if (!['include', 'a', 'mx', 'ptr', 'exists', 'redirect'].includes(nom)) return;
        etat.consultations += 1;
        if (nom === 'ptr') etat.ptr = true;
        if (nom !== 'include' && nom !== 'redirect') return;
        const cible = String(m[2] || '').split('/')[0].toLowerCase();
        if (!cible) return;
        if (cible.includes('%')) { etat.macros = true; return; }
        if (etat.vus.has(cible)) { etat.erreurs.push(`boucle sur ${cible}`); return; }
        // Verdict acquis : on cesse de descendre, et le total devient un minimum.
        if (etat.consultations > MAX_CONSULTATIONS_SPF) { etat.tronque = true; return; }
        if (etat.requetes >= MAX_REQUETES_SPF) { etat.incomplet = true; return; }
        etat.vus.add(cible);
        etat.requetes += 1;
        const r = requeteDoH_(cible, 'TXT');
        if (r.statut === 'erreur') { etat.incomplet = true; return; }
        const sous = (r.reponses || []).filter(estSpf_);
        if (!sous.length) { etat.erreurs.push(`${cible} n'a pas de SPF (l'${nom} échoue)`); return; }
        compterConsultationsSpf_(sous[0], etat);
    });
    return etat;
};

const controlerSpf_ = (domaine) => {
    const r = requeteDoH_(domaine, 'TXT');
    if (r.statut === 'erreur') {
        return [constatDns_(domaine, 'SPF', STATUTS_DNS.NON_VERIFIE, 'Le DNS n\'a pas répondu.', 'Relancer le contrôle plus tard.')];
    }
    const spf = (r.reponses || []).filter(estSpf_);
    if (!spf.length) {
        return [constatDns_(domaine, 'SPF', STATUTS_DNS.ATTENTION,
            'Aucun SPF : DMARC ne peut s\'appuyer que sur DKIM.',
            'Publier un SPF listant vos serveurs d\'envoi, terminé par -all (v=spf1 -all si le domaine n\'envoie jamais d\'e-mail).')];
    }
    if (spf.length > 1) {
        return [constatDns_(domaine, 'SPF', STATUTS_DNS.PROBLEME,
            `${spf.length} enregistrements SPF : le SPF échoue (permerror) chez tous les destinataires.`,
            'Les fusionner en un seul.', spf.join(' | '))];
    }

    const brut = spf[0];
    const constats = [];
    const etat = compterConsultationsSpf_(brut, { consultations: 0, requetes: 0, vus: new Set([domaine]),
        erreurs: [], incomplet: false, tronque: false, macros: false, ptr: false });
    if (etat.consultations > MAX_CONSULTATIONS_SPF) {
        constats.push(constatDns_(domaine, 'SPF', STATUTS_DNS.PROBLEME,
            `${etat.incomplet || etat.tronque ? 'au moins ' : ''}${etat.consultations} consultations DNS pour une limite de `
                + `${MAX_CONSULTATIONS_SPF} : le SPF échoue (permerror) chez tous les destinataires.`,
            'Retirer les include: inutiles, ou remplacer certains par les adresses ip4:/ip6: qu\'ils désignent.', brut));
    } else if (etat.erreurs.length) {
        constats.push(constatDns_(domaine, 'SPF', STATUTS_DNS.PROBLEME, `SPF en erreur : ${etat.erreurs.join(' ; ')}.`,
            'Corriger ou retirer l\'include: en cause.', brut));
    } else if (etat.incomplet) {
        constats.push(constatDns_(domaine, 'SPF', STATUTS_DNS.NON_VERIFIE,
            `Au moins ${etat.consultations} consultations DNS ; le décompte n'a pas pu aller au bout.`,
            'Relancer le contrôle plus tard.', brut));
    } else {
        constats.push(constatDns_(domaine, 'SPF', etat.consultations >= 9 ? STATUTS_DNS.ATTENTION : STATUTS_DNS.OK,
            `${etat.consultations} consultation(s) DNS sur ${MAX_CONSULTATIONS_SPF} permises`
                + (etat.macros ? ' (hors macros, non évaluées)' : '') + '.',
            etat.consultations >= 9 ? 'Presque à la limite : le moindre include: supplémentaire fera échouer le SPF.' : '',
            brut));
    }
    if (etat.ptr) {
        constats.push(constatDns_(domaine, 'SPF', STATUTS_DNS.ATTENTION,
            'Le mécanisme ptr est déconseillé (RFC 7208) : lent, et ignoré par certains destinataires.',
            'Le remplacer par les adresses ip4:/ip6: concernées.', brut));
    }

    const fin = brut.trim().split(/\s+/).map(t => t.toLowerCase()).find(t => /^[+?~-]?all$/.test(t));
    const redirection = /(^|\s)redirect=/i.test(brut);
    if (!fin && !redirection) {
        constats.push(constatDns_(domaine, 'SPF', STATUTS_DNS.ATTENTION,
            'Le SPF ne se termine pas par un mécanisme all : les serveurs non listés sont « neutres ».',
            'Terminer par -all (ou ~all pendant une transition).', brut));
    } else if (fin === 'all' || fin === '+all') {
        constats.push(constatDns_(domaine, 'SPF', STATUTS_DNS.PROBLEME,
            'Le SPF se termine par +all : n\'importe quel serveur au monde est autorisé.',
            'Remplacer +all par -all.', brut));
    } else if (fin === '?all') {
        constats.push(constatDns_(domaine, 'SPF', STATUTS_DNS.ATTENTION,
            'Le SPF se termine par ?all : les serveurs non listés sont « neutres », ni acceptés ni refusés.',
            'Remplacer ?all par ~all ou -all.', brut));
    }
    return constats;
};

/* ===================== DKIM ===================== */

const controlerDkim_ = (domaine, selecteursIndiques) => {
    const selecteurs = selecteursIndiques.length ? selecteursIndiques : [...SELECTEURS_DKIM_COURANTS];
    const trouves = [];
    const revoques = [];
    let pannes = 0;
    selecteurs.forEach((s) => {
        const r = requeteDoH_(`${s}._domainkey.${domaine}`, 'TXT');
        if (r.statut === 'erreur') { pannes += 1; return; }
        const cle = (r.reponses || []).find(t => /(^|;)\s*p=/i.test(t));
        if (!cle) return;
        // p= vide : clé révoquée volontairement (RFC 6376 § 3.6.1).
        const p = (/(?:^|;)\s*p=([^;]*)/i.exec(cle) || [])[1] || '';
        (p.trim() ? trouves : revoques).push(s);
    });
    const essayes = `sélecteurs essayés : ${selecteurs.join(', ')}`;
    if (trouves.length) {
        return [constatDns_(domaine, 'DKIM', STATUTS_DNS.OK, `Clé(s) publiée(s) : ${trouves.join(', ')}`
            + (revoques.length ? ` ; révoquée(s) : ${revoques.join(', ')}` : '') + '.', '', essayes)];
    }
    if (pannes) {
        return [constatDns_(domaine, 'DKIM', STATUTS_DNS.NON_VERIFIE, 'Le DNS n\'a pas répondu pour certains sélecteurs.',
            'Relancer le contrôle plus tard.', essayes)];
    }
    return [constatDns_(domaine, 'DKIM', selecteursIndiques.length ? STATUTS_DNS.PROBLEME : STATUTS_DNS.ATTENTION,
        selecteursIndiques.length
            ? 'Aucune clé publiée pour les sélecteurs indiqués' + (revoques.length ? ` (révoquée(s) : ${revoques.join(', ')})` : '') + '.'
            : 'Aucune clé parmi les sélecteurs courants. Un sélecteur est libre : ce n\'est pas forcément une absence.',
        selecteursIndiques.length
            ? 'Vérifier les sélecteurs, ou publier la clé chez votre fournisseur de messagerie.'
            : 'Indiquer vos sélecteurs dans la colonne selecteurs_dkim de l\'onglet Domaines. Le sélecteur se lit dans '
                + 'l\'en-tête DKIM-Signature (s=) d\'un e-mail envoyé.',
        essayes)];
};

/* ===================== Contrôle et écriture ===================== */

/**
 * Contrôle tous les domaines de l'onglet Domaines et réécrit l'onglet
 * « Contrôle DNS ». Rend { domaines, problemes, attentions, nonVerifies }.
 */
const controlerDnsDomaines_ = (ss, maintenant = new Date()) => {
    const { domaines, adresses, selecteurs } = lireOngletDomaines_(ss);
    const constats = [];
    [...domaines].sort().forEach((d) => {
        constats.push(...controlerDmarc_(d, adresses), ...controlerSpf_(d), ...controlerDkim_(d, selecteurs.get(d) || []));
    });

    const sh = feuille_(ss, CONFIG_DMARC.ONGLET_DNS, ENTETES_CONTROLE_DNS);
    const lignes = constats.map(c => [c.domaine, c.element, c.statut, c.constat, c.aFaire, c.enregistrement, maintenant]);
    const ancien = sh.getLastRow() - 1;
    if (lignes.length) {
        sh.getRange(2, 1, lignes.length, ENTETES_CONTROLE_DNS.length).setValues(lignes.map(l => l.map(celluleTexte_)));
        sh.getRange(2, 3, lignes.length, 1).setBackgrounds(lignes.map(l => [COULEURS_STATUT_DNS[l[2]] || null]));
        sh.getRange(2, 7, lignes.length, 1).setNumberFormat('dd/mm/yyyy hh:mm');
    }
    if (ancien > lignes.length) {
        const reste = sh.getRange(lignes.length + 2, 1, ancien - lignes.length, ENTETES_CONTROLE_DNS.length);
        reste.clearContent();
        sh.getRange(lignes.length + 2, 3, ancien - lignes.length, 1).setBackgrounds(
            Array.from({ length: ancien - lignes.length }, () => [null]));
    }
    PropertiesService.getScriptProperties().setProperty('DNS_DERNIER_CONTROLE', String(maintenant.getTime()));

    const compter = s => constats.filter(c => c.statut === s).length;
    return { domaines: domaines.size, problemes: compter(STATUTS_DNS.PROBLEME),
        attentions: compter(STATUTS_DNS.ATTENTION), nonVerifies: compter(STATUTS_DNS.NON_VERIFIE) };
};

/** Résumé d'un contrôle, pour le bilan et le menu. */
const resumeControleDns_ = r => (r.domaines
    ? `Contrôle DNS de ${r.domaines} domaine(s) : ${r.problemes} problème(s), ${r.attentions} point(s) d'attention`
        + (r.nonVerifies ? `, ${r.nonVerifies} non vérifié(s)` : '') + ` — détail dans l'onglet « ${CONFIG_DMARC.ONGLET_DNS} ».`
    : `Contrôle DNS : aucun domaine dans l'onglet « ${CONFIG_DMARC.ONGLET_DOMAINES} ».`);

/** Contrôle quotidien, depuis le traitement horaire : rend le résumé, ou null si pas encore dû. */
const controlerDnsSiDu_ = (ss, maintenant = new Date()) => {
    const dernier = Number(PropertiesService.getScriptProperties().getProperty('DNS_DERNIER_CONTROLE'));
    if (Number.isFinite(dernier) && dernier > 0 && maintenant.getTime() - dernier < UN_JOUR_MS_DNS) return null;
    return resumeControleDns_(controlerDnsDomaines_(ss, maintenant));
};

/** Menu DMARC > Contrôler les enregistrements DNS. */
function controlerDnsDepuisMenu() {
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const verrou = LockService.getScriptLock();
    if (!verrou.tryLock(5000)) {
        ui.alert('Un traitement est en cours. Relancez le contrôle dans quelques minutes.');
        return;
    }
    try {
        const resume = resumeControleDns_(controlerDnsDomaines_(ss));
        journaliser_(ss, 'contrôle DNS', resume);
        const sh = ss.getSheetByName(CONFIG_DMARC.ONGLET_DNS);
        if (sh) ss.setActiveSheet(sh);
        ui.alert('Contrôle des enregistrements DNS', resume, ui.ButtonSet.OK);
    } catch (e) {
        console.error(`Contrôle DNS : ${e}`);
        ui.alert(`Contrôle DNS impossible : ${e.message || e}`);
    } finally {
        verrou.releaseLock();
    }
}
