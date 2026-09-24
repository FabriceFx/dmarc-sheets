/**
 * Rapports DMARC — jeu de données de démonstration, entièrement fictif.
 *
 *     node demo/generer-demo.js [aaaa-mm-jj]
 *
 * Produit, dans demo/ :
 *   - Rapports.csv, Enregistrements.csv, Domaines.csv, _CacheIP.csv, à importer
 *     dans un classeur de démonstration (voir demo/README.md) ;
 *   - RESUME.md, les chiffres que le tableau de bord affichera.
 *
 * Tout est inventé, mais construit sur des situations réellement observées :
 * envois propres, prestataire bien ou mal configuré, transferts, messages
 * légitimes abîmés par la passerelle de filtrage d'un destinataire (DKIM
 * cassé), usurpations (DKIM absent), émetteur de rapports muet sur DKIM.
 *
 * Garanties d'anonymat, vérifiées par le banc d'essai :
 *   - tous les domaines de l'organisation et des tiers sont en `.example`
 *     (RFC 2606 : réservé, ne peut appartenir à personne) ;
 *   - toutes les adresses IP sont dans les plages de documentation
 *     192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (RFC 5737).
 * Seuls les noms des émetteurs de rapports (google.com, Yahoo…) sont réels :
 * ce sont des services publics, pas des données.
 *
 * Déterministe : même date de référence, mêmes données. Les fonctions de
 * diagnostic sont celles du projet, chargées depuis les .gs : les chiffres de
 * RESUME.md sont ceux que l'outil calculera.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.join(__dirname, '..');
// Dossier de sortie : demo/ par défaut ; le banc d'essai en fournit un temporaire.
const SORTIE = process.env.DMARC_DEMO_SORTIE || __dirname;

/* --------------------------------------------------------------------------
 * Fonctions du projet
 * ----------------------------------------------------------------------- */

const projet = {};
vm.createContext(projet);
['DmarcRapport.gs', 'DmarcFeuilles.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(RACINE, f), 'utf8'), projet, { filename: f });
});
const diagnosticDkim = vm.runInContext('diagnosticDkim_', projet);
const cleRapport = vm.runInContext('cleRapport_', projet);

/* --------------------------------------------------------------------------
 * Hasard reproductible
 * ----------------------------------------------------------------------- */

const graine = (s) => {
    let a = s >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
const hasard = graine(20260924);
const entre = (min, max) => min + Math.floor(hasard() * (max - min + 1));
const parfois = p => hasard() < p;

/* --------------------------------------------------------------------------
 * L'organisation fictive et son environnement
 * ----------------------------------------------------------------------- */

const DOMAINES = [
    { domaine: 'laiterie.example', p: 'reject', poids: 1 },
    { domaine: 'boutique-laiterie.example', p: 'quarantine', poids: 0.15 }
];

const EMETTEURS = [
    { org: 'google.com', email: 'noreply-dmarc-support@google.com', part: 0.55, detailleDkim: true },
    { org: 'Enterprise Outlook', email: 'dmarcreport@microsoft.com', part: 0.2, detailleDkim: true },
    { org: 'Yahoo', email: 'dmarchelp@yahooinc.com', part: 0.1, detailleDkim: true },
    { org: 'Mimecast', email: 'dmarc-report@mimecast.com', part: 0.1, detailleDkim: true },
    // Constaté sur des rapports réels : un émetteur qui ne détaille DKIM pour aucun message.
    { org: 'AMAZON-SES', email: 'postmaster@amazonses.com', part: 0.05, detailleDkim: false }
];

/** Sources : IP, nom d'hôte affiché, et fabrique d'enregistrement. */
const SOURCES = {
    propres: ['203.0.113.10', '203.0.113.11', '203.0.113.12', '203.0.113.13'],
    lettre: '198.51.100.20',
    transfert: '192.0.2.50',
    passerelles: ['192.0.2.80', '192.0.2.81', '192.0.2.82'],
    relaisMuet: '192.0.2.120',
    crm: '198.51.100.60',
    usurpateurs: ['198.51.100.201', '198.51.100.202', '198.51.100.203', '198.51.100.204', '198.51.100.205']
};

const NOMS_HOTE = [
    ...SOURCES.propres.map(ip => [ip, 'smtp.laiterie.example (vérifié)', 'confirme', 'smtp.laiterie.example']),
    [SOURCES.lettre, 'mta.lettre-pro.example (vérifié)', 'confirme', 'mta.lettre-pro.example'],
    [SOURCES.transfert, 'mx.cooperative-client.example (vérifié)', 'confirme', 'mx.cooperative-client.example'],
    ...SOURCES.passerelles.map(ip => [ip, 'filtre.passerelle-securite.example (vérifié)', 'confirme',
        'filtre.passerelle-securite.example']),
    [SOURCES.relaisMuet, 'relais.distributeur.example (vérifié)', 'confirme', 'relais.distributeur.example'],
    [SOURCES.crm, 'envoi.crm-saas.example (vérifié)', 'confirme', 'envoi.crm-saas.example'],
    [SOURCES.usurpateurs[0], 'NON VÉRIFIÉ : mail.banque-fictive.example ne renvoie pas vers cette IP',
        'non_confirme', 'mail.banque-fictive.example'],
    ...SOURCES.usurpateurs.slice(1).map(ip => [ip, 'Aucun nom d\'hôte (pas de PTR)', 'absent', ''])
];

/**
 * Un groupe de messages : [ip, count, disposition, dkim_eval, spf_eval,
 * header_from, envelope_from, dkim_domaines, dkim_resultats, spf_domaines,
 * spf_resultats] — l'ordre de parserRapport_.
 */
const groupe = ({ ip, n, conforme, p, from, enveloppe, dkim = [], spf }) => {
    const dkimEval = dkim.some(([d, r]) => d === from && r === 'pass') ? 'pass' : 'fail';
    const spfEval = spf && spf[0] === from && spf[1] === 'pass' ? 'pass' : 'fail';
    const disposition = conforme ? 'none' : p;
    return [ip, n, disposition, dkimEval, spfEval, from, enveloppe,
        dkim.map(([d]) => d).join(', '), dkim.map(([, r]) => r).join(', '),
        spf ? spf[0] : '', spf ? spf[1] : ''];
};

/** Les groupes de messages d'un rapport quotidien, pour un domaine et un émetteur. */
const groupesDuJour = ({ domaine, p, poids }, emetteur) => {
    const echelle = poids * emetteur.part;
    const g = [];
    const d = domaine;
    // Envois propres (Google Workspace fictif) : conformes par DKIM et SPF.
    SOURCES.propres.forEach((ip) => {
        const n = Math.round(entre(250, 450) * echelle);
        if (n > 0) g.push(groupe({ ip, n, conforme: true, p, from: d, enveloppe: d, dkim: [[d, 'pass']], spf: [d, 'pass'] }));
    });
    // Lettre d'information bien configurée : signe au nom du domaine, enveloppe du prestataire.
    if (domaine === 'laiterie.example' && parfois(0.6)) {
        g.push(groupe({ ip: SOURCES.lettre, n: Math.round(entre(80, 200) * echelle) || 1, conforme: true, p,
            from: d, enveloppe: 'bounce.lettre-pro.example', dkim: [[d, 'pass']], spf: ['bounce.lettre-pro.example', 'pass'] }));
    }
    // Transfert automatique chez un client : SPF casse, DKIM survit, donc conforme.
    if (parfois(0.5)) {
        g.push(groupe({ ip: SOURCES.transfert, n: entre(1, 6), conforme: true, p, from: d, enveloppe: d,
            dkim: [[d, 'pass']], spf: [d, 'fail'] }));
    }
    // Passerelle de filtrage d'un destinataire : message modifié, DKIM cassé, rejeté.
    if ((emetteur.org === 'Enterprise Outlook' || emetteur.org === 'Mimecast') && parfois(0.55)) {
        const ip = SOURCES.passerelles[entre(0, SOURCES.passerelles.length - 1)];
        g.push(groupe({ ip, n: entre(1, 7), conforme: false, p, from: d, enveloppe: d, dkim: [[d, 'fail']], spf: [d, 'fail'] }));
    }
    // CRM mal configuré : signe avec son propre domaine (DKIM d'un tiers).
    if (domaine === 'boutique-laiterie.example' && emetteur.org === 'google.com' && parfois(0.7)) {
        g.push(groupe({ ip: SOURCES.crm, n: entre(2, 9), conforme: false, p, from: d, enveloppe: 'crm-saas.example',
            dkim: [['crm-saas.example', 'pass']], spf: ['crm-saas.example', 'pass'] }));
    }
    // Relais d'un distributeur, signalé par un émetteur muet sur DKIM.
    if (!emetteur.detailleDkim && parfois(0.4)) {
        g.push(groupe({ ip: SOURCES.relaisMuet, n: entre(1, 3), conforme: false, p, from: d, enveloppe: d,
            dkim: [[d, 'fail']], spf: [d, 'fail'] }));
    }
    // Usurpations : aucune signature, IP sans nom ou au nom usurpé.
    if ((emetteur.org === 'google.com' || emetteur.org === 'Yahoo') && parfois(0.22)) {
        const ip = SOURCES.usurpateurs[entre(0, SOURCES.usurpateurs.length - 1)];
        g.push(groupe({ ip, n: entre(1, 3), conforme: false, p, from: d, enveloppe: '', dkim: [],
            spf: [parfois(0.5) ? d : 'fraudeur.example', parfois(0.5) ? 'fail' : 'softfail'] }));
    }
    // Un émetteur muet sur DKIM : on efface le détail, comme dans ses vrais rapports.
    if (!emetteur.detailleDkim) g.forEach((l) => { l[7] = ''; l[8] = ''; });
    return g;
};

/* --------------------------------------------------------------------------
 * Génération
 * ----------------------------------------------------------------------- */

const argument = process.argv[2];
const reference = argument ? new Date(`${argument}T00:00:00`) : new Date();
reference.setHours(0, 0, 0, 0);
const UN_JOUR = 24 * 60 * 60 * 1000;
const deuxChiffres = n => String(n).padStart(2, '0');
const texteDate = d => `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())} `
    + `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}:${deuxChiffres(d.getSeconds())}`;
const jourCompact = d => `${d.getFullYear()}${deuxChiffres(d.getMonth() + 1)}${deuxChiffres(d.getDate())}`;

const rapports = [];
const enregistrements = [];
for (let j = 30; j >= 1; j -= 1) {
    const debut = new Date(reference.getTime() - j * UN_JOUR);
    const fin = new Date(debut.getTime() + UN_JOUR - 1000);
    const traite = new Date(fin.getTime() + entre(2, 10) * 60 * 60 * 1000);
    DOMAINES.forEach((dom) => {
        EMETTEURS.forEach((em) => {
            if (!parfois(dom.poids < 1 ? 0.75 : 0.97)) return;
            const groupes = groupesDuJour(dom, em);
            if (!groupes.length) return;
            // Identifiant non numérique : un identifiant fait de chiffres serait
            // converti en nombre à l'import CSV, comme Sheets le fait partout.
            const id = `demo-${em.org.toLowerCase().replace(/[^a-z]/g, '')}-${jourCompact(debut)}-${dom.domaine.split('.')[0]}`;
            const cle = cleRapport(em.org, id);
            rapports.push([id, em.org, em.email, texteDate(debut), texteDate(fin), dom.domaine, 'r', 'r', dom.p,
                dom.p, 100, `${id}.xml`, texteDate(traite), cle]);
            const detaille = groupes.some(l => String(l[7]).trim());
            groupes.forEach((l) => {
                enregistrements.push([id, dom.domaine, ...l, cle, diagnosticDkim(l[5], l[7], l[8], detaille)]);
            });
        });
    });
}

/* --------------------------------------------------------------------------
 * Écriture des CSV
 * ----------------------------------------------------------------------- */

const cellule = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const ecrireCsv = (nom, entetes, lignes) => {
    const contenu = [entetes, ...lignes].map(l => l.map(cellule).join(',')).join('\r\n');
    fs.writeFileSync(path.join(SORTIE, nom), `${contenu}\r\n`, 'utf8');
};

const config = {}; vm.createContext(config);
vm.runInContext(fs.readFileSync(path.join(RACINE, 'DmarcConfig.gs'), 'utf8'), config);
const lire = nom => [...vm.runInContext(nom, config)];

ecrireCsv('Rapports.csv', lire('ENTETES_RAPPORTS'), rapports);
ecrireCsv('Enregistrements.csv', lire('ENTETES_ENREG'), enregistrements);
ecrireCsv('Domaines.csv', ['domaine', 'adresse_rua', 'commentaire'], [
    ['laiterie.example', 'dmarc@laiterie.example', 'domaine principal (fictif)'],
    ['boutique-laiterie.example', '', 'boutique en ligne (fictive)']
]);
ecrireCsv('_CacheIP.csv', ['ip', 'affichage', 'statut', 'hote', 'operateur', 'mis_a_jour'],
    NOMS_HOTE.map(([ip, affichage, statut, hote]) => [ip, affichage, statut, hote, '', texteDate(reference)]));

/* --------------------------------------------------------------------------
 * Résumé : ce que le tableau de bord affichera (C4 = Tous, C5 = 30 jours)
 * ----------------------------------------------------------------------- */

const somme = (lignes, f) => lignes.reduce((s, l) => s + f(l), 0);
const E = { count: 3, disposition: 4, dkimEval: 5, spfEval: 6, ip: 2, domaine: 1, envelope: 8, diag: 14 };
const conforme = l => l[E.dkimEval] === 'pass' || l[E.spfEval] === 'pass';
const messages = somme(enregistrements, l => l[E.count]);
const pourcent = x => `${(100 * x).toFixed(1).replace('.', ',')} %`;
const nombre = n => n.toLocaleString('fr-FR');
const nonConformes = enregistrements.filter(l => !conforme(l));
const rejetes = enregistrements.filter(l => l[E.disposition] === 'reject');
const parDiag = (lignes) => {
    const t = {};
    lignes.forEach((l) => { t[l[E.diag]] = (t[l[E.diag]] || 0) + l[E.count]; });
    return t;
};
const diagNc = parDiag(nonConformes);
const diagRej = parDiag(rejetes);
const nomHote = new Map(NOMS_HOTE.map(([ip, a]) => [ip, a]));
const top = Object.values(nonConformes.reduce((acc, l) => {
    const k = [l[E.domaine], l[E.ip], l[E.envelope], l[E.disposition], l[E.diag]].join('|');
    acc[k] = acc[k] || { k, n: 0 };
    acc[k].n += l[E.count];
    return acc;
}, {})).sort((a, b) => b.n - a.n).slice(0, 8);

const DIAGS = ['DKIM cassé', 'DKIM d\'un tiers', 'DKIM absent', 'DKIM non renseigné'];
const resume = `# Jeu de démonstration — chiffres attendus

> **Données entièrement fictives**, générées par \`demo/generer-demo.js\`
> (référence : ${texteDate(reference).slice(0, 10)}). Domaines en \`.example\`, adresses IP
> de documentation. À ne pas présenter comme des données réelles.

Tableau de bord avec C4 = « Tous » et C5 = 30 jours.

| Indicateur | Valeur |
| --- | --- |
| Rapports | ${nombre(rapports.length)} |
| Messages | ${nombre(messages)} |
| Taux de conformité | ${pourcent(somme(enregistrements.filter(conforme), l => l[E.count]) / messages)} |
| Taux DKIM | ${pourcent(somme(enregistrements.filter(l => l[E.dkimEval] === 'pass'), l => l[E.count]) / messages)} |
| Taux SPF | ${pourcent(somme(enregistrements.filter(l => l[E.spfEval] === 'pass'), l => l[E.count]) / messages)} |
| Messages rejetés | ${nombre(somme(rejetes, l => l[E.count]))} |
| Non conformes non rejetés | ${nombre(somme(nonConformes.filter(l => l[E.disposition] !== 'reject'), l => l[E.count]))} |

## Non conformes : signature DKIM

| Signature | Non conformes | dont rejetés |
| --- | --- | --- |
${DIAGS.map(d => `| ${d} | ${nombre(diagNc[d] || 0)} | ${nombre(diagRej[d] || 0)} |`).join('\n')}

Part des rejets qui sont des messages légitimes abîmés en route (DKIM cassé) :
**${pourcent((diagRej['DKIM cassé'] || 0) / somme(rejetes, l => l[E.count]))}**.

## Principales sources non conformes

| Domaine | IP | Enveloppe | Disposition | DKIM | Messages | Nom d'hôte |
| --- | --- | --- | --- | --- | --- | --- |
${top.map(({ k, n }) => {
        const [dom, ip, env, disp, diag] = k.split('|');
        return `| ${dom} | ${ip} | ${env || '—'} | ${disp} | ${diag} | ${n} | ${nomHote.get(ip) || '—'} |`;
    }).join('\n')}
`;
fs.writeFileSync(path.join(SORTIE, 'RESUME.md'), resume, 'utf8');

console.log(`Jeu de démonstration écrit dans ${path.relative(process.cwd(), SORTIE) || '.'} : `
    + `${rapports.length} rapports, ${enregistrements.length} enregistrements, ${messages} messages.`);
