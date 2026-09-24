/**
 * DMARC — extraction des pièces jointes et lecture du XML agrégé (RFC 7489).
 * Introduit en v1.0.0.
 */

/** Types MIME d'un XML. `includes('xml')` attrapait aussi les .docx/.xlsx (openxmlformats). */
const TYPE_XML_DMARC = /^(text|application)\/xml\b/;

/** Renvoie la liste des blobs XML contenus dans une pièce jointe. */
const extraireXml_ = (blob) => {
    const nomOrigine = blob.getName() || '';
    const nom = nomOrigine.toLowerCase();
    const type = (blob.getContentType() || '').toLowerCase();

    // .gz testé en premier car "gzip" contient "zip"
    if (nom.endsWith('.gz') || type.includes('gzip')) {
        const b = blob.copyBlob().setContentType('application/x-gzip');
        const xml = Utilities.ungzip(b);
        xml.setName(nomOrigine.replace(/\.gz$/i, '') || 'rapport.xml');
        return [xml];
    }
    if (nom.endsWith('.zip') || type.includes('zip')) {
        const b = blob.copyBlob().setContentType('application/zip');
        return Utilities.unzip(b).filter(f => (f.getName() || '').toLowerCase().endsWith('.xml'));
    }
    if (nom.endsWith('.xml') || TYPE_XML_DMARC.test(type)) return [blob];
    return [];
};

/**
 * Parse un rapport DMARC agrégé (avec ou sans espace de noms).
 *
 * Rend des valeurs brutes : la protection contre l'interprétation par Sheets
 * (formules, grands nombres) se fait à l'écriture, dans `ajouterLignes_`.
 */
const parserRapport_ = (xmlTexte) => {
    const doc = XmlService.parse(xmlTexte.replace(/^\uFEFF/, '').trim());
    const root = doc.getRootElement();
    const ns = root.getNamespace();

    const enfant = (el, nom) => (el ? el.getChild(nom, ns) : null);
    const texte = (el, ...chemin) => {
        let e = el;
        for (const n of chemin) { e = enfant(e, n); if (!e) return ''; }
        return e.getText().trim();
    };
    const date = s => {
        const n = Number(s);
        return (s !== '' && Number.isFinite(n) && n > 0) ? new Date(n * 1000) : '';
    };
    // pct est le seul champ numérique du rapport : un nombre reste un nombre,
    // tout le reste reste texte.
    const nombre = s => (s !== '' && Number.isFinite(Number(s)) ? Number(s) : s);

    const meta = enfant(root, 'report_metadata');
    const pol = enfant(root, 'policy_published');

    const rapport = [
        texte(meta, 'report_id'),
        texte(meta, 'org_name'),
        texte(meta, 'email'),
        date(texte(meta, 'date_range', 'begin')),
        date(texte(meta, 'date_range', 'end')),
        texte(pol, 'domain'),
        texte(pol, 'adkim'),
        texte(pol, 'aspf'),
        texte(pol, 'p'),
        texte(pol, 'sp'),
        nombre(texte(pol, 'pct'))
    ];
    if (!rapport[0]) throw new Error('report_id introuvable');

    const enregistrements = root.getChildren('record', ns).map(r => {
        const auth = enfant(r, 'auth_results');
        const dkim = auth ? auth.getChildren('dkim', ns) : [];
        const spf = auth ? auth.getChildren('spf', ns) : [];
        return [
            texte(r, 'row', 'source_ip'),
            Number(texte(r, 'row', 'count')) || 0,
            texte(r, 'row', 'policy_evaluated', 'disposition'),
            texte(r, 'row', 'policy_evaluated', 'dkim'),
            texte(r, 'row', 'policy_evaluated', 'spf'),
            texte(r, 'identifiers', 'header_from'),
            texte(r, 'identifiers', 'envelope_from'),
            dkim.map(d => texte(d, 'domain')).join(', '),
            dkim.map(d => texte(d, 'result')).join(', '),
            spf.map(s => texte(s, 'domain')).join(', '),
            spf.map(s => texte(s, 'result')).join(', ')
        ];
    });

    return { rapport, enregistrements };
};

/**
 * Diagnostic de la signature DKIM d'un groupe de messages, pour distinguer un
 * message légitime abîmé en route d'une usurpation. Introduit en v1.7.0.
 *
 * Un usurpateur ne peut pas signer au nom de votre domaine : une signature de
 * votre domaine qui échoue désigne presque toujours un message parti de chez
 * vous puis modifié par un intermédiaire (transfert, passerelle de filtrage qui
 * ajoute un bandeau ou réécrit les liens). Aucune signature du tout est, à
 * l'inverse, le signe habituel de l'usurpation.
 */
const DIAGNOSTICS_DKIM = Object.freeze({
    VALIDE: 'DKIM valide',
    CASSE: 'DKIM cassé',
    TIERS: 'DKIM d\'un tiers',
    ABSENT: 'DKIM absent',
    NON_RENSEIGNE: 'DKIM non renseigné'
});

/**
 * « Votre domaine » = le domaine de l'adresse visible (header_from), ses
 * sous-domaines et son parent. Approximation de l'alignement souple de DMARC,
 * qui compare les domaines principaux : deux sous-domaines frères
 * (a.example.com, b.example.com) ne sont pas reconnus, faute de liste des
 * suffixes publics dans le script.
 */
const memeDomaine_ = (a, b) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);

/**
 * `dkimDomaines` et `dkimResultats` : les listes « d1, d2 » écrites dans
 * l'onglet Enregistrements, dans le même ordre.
 *
 * `rapportDetailleDkim` : faux quand AUCUN enregistrement du rapport ne
 * détaille DKIM. La RFC 7489 rend ce détail facultatif, et certains émetteurs
 * l'omettent (constaté : un rapport AMAZON-SES muet sur DKIM pour des messages
 * que le domaine signe tous). « Aucune signature signalée » ne veut alors pas
 * dire « aucune signature » : le diagnostic dit qu'il ne sait pas, plutôt que
 * d'annoncer une usurpation.
 */
const diagnosticDkim_ = (headerFrom, dkimDomaines, dkimResultats, rapportDetailleDkim = true) => {
    const liste = v => String(v || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    const domaines = liste(dkimDomaines);
    const resultats = liste(dkimResultats);
    if (!domaines.length) return rapportDetailleDkim ? DIAGNOSTICS_DKIM.ABSENT : DIAGNOSTICS_DKIM.NON_RENSEIGNE;
    const from = String(headerFrom || '').trim().toLowerCase().replace(/\.$/, '');
    const siens = domaines.map((d, i) => ({ d: d.replace(/\.$/, ''), r: resultats[i] || '' }))
        .filter(({ d }) => from && memeDomaine_(d, from));
    if (!siens.length) return DIAGNOSTICS_DKIM.TIERS;
    return siens.some(({ r }) => r === 'pass') ? DIAGNOSTICS_DKIM.VALIDE : DIAGNOSTICS_DKIM.CASSE;
};

