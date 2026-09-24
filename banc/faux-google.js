/**
 * Banc d'essai — simulateurs des services Google.
 *
 * **Un faux service complaisant valide du code faux.** Les points où ce
 * simulateur refuse ou transforme comme le vrai :
 *
 *   - `setValues` interprète les chaînes comme Sheets : `=…` devient une
 *     formule, une chaîne de chiffres devient un nombre en double précision
 *     (un report_id de 20 chiffres perd ses 5 derniers), une date ISO devient
 *     un objet `Date` ; l'apostrophe initiale force le texte et ne revient pas
 *     à la lecture ;
 *   - `Utilities.ungzip` / `unzip` lèvent si le type MIME n'est pas le bon ;
 *   - `GmailApp.search` plafonne `max` à 500 ;
 *   - `XmlService.parse` lève sur un XML mal formé.
 */

'use strict';

const zlib = require('zlib');

/* --------------------------------------------------------------------------
 * Classeur
 * ----------------------------------------------------------------------- */

/** Marque une cellule que Sheets a prise pour une formule. */
class Formule {
    constructor(texte) { this.texte = texte; }
}

const EST_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const EST_NOMBRE = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/** Reproduit la conversion que Sheets applique en stockant une valeur. */
const commeSheets = (valeur) => {
    if (valeur === undefined || valeur === null) return '';
    if (typeof valeur !== 'string') return valeur;
    if (valeur.startsWith("'")) return valeur.slice(1);
    if (valeur.startsWith('=')) return new Formule(valeur);
    if (EST_NOMBRE.test(valeur.trim())) return Number(valeur);
    if (EST_JOUR.test(valeur)) return new Date(`${valeur}T00:00:00Z`);
    return valeur;
};

class FaussePlage {
    constructor(feuille, ligne, colonne, hauteur, largeur) {
        Object.assign(this, { feuille, ligne, colonne, hauteur, largeur });
    }

    setValues(valeurs) {
        this.feuille.operations.push(['setValues', this.ligne, valeurs.length]);
        if (valeurs.length !== this.hauteur) {
            throw new Error('The number of rows in the data does not match the number of rows in the range. '
                + `The data has ${valeurs.length} but the range has ${this.hauteur}.`);
        }
        valeurs.forEach((cellules, decalage) => {
            if (cellules.length !== this.largeur) {
                throw new Error('The number of columns in the data does not match the number of columns '
                    + `in the range. The data has ${cellules.length} but the range has ${this.largeur}.`);
            }
            const ligne = this.ligne + decalage - 1;
            while (this.feuille.cellules.length <= ligne) this.feuille.cellules.push([]);
            cellules.forEach((valeur, position) => {
                this.feuille.cellules[ligne][this.colonne - 1 + position] = commeSheets(valeur);
            });
        });
        return this;
    }

    getValues() {
        const sortie = [];
        for (let l = 0; l < this.hauteur; l += 1) {
            const source = this.feuille.cellules[this.ligne - 1 + l] || [];
            const ligne = [];
            for (let c = 0; c < this.largeur; c += 1) {
                const valeur = source[this.colonne - 1 + c];
                ligne.push(valeur === undefined ? '' : valeur);
            }
            sortie.push(ligne);
        }
        return sortie;
    }

    setFontWeight() { return this; }
    clearContent() {
        this.feuille.operations.push(['clearContent', this.ligne, this.hauteur]);
        for (let l = 0; l < this.hauteur; l += 1) {
            const ligne = this.ligne - 1 + l;
            if (this.feuille.cellules[ligne]) {
                for (let c = 0; c < this.largeur; c += 1) {
                    this.feuille.cellules[ligne][this.colonne - 1 + c] = '';
                }
            }
        }
        return this;
    }
    /** Comme le vrai : la même valeur dans chaque cellule de la plage. */
    setValue(v) {
        return this.setValues(Array.from({ length: this.hauteur }, () => Array(this.largeur).fill(v)));
    }
    merge() { return this; }
    setNotes(notes) { this.verifierDimensions('notes', notes); return this; }
    setFormulas(formules) {
        this.verifierDimensions('formulas', formules);
        formules.forEach((ligne, dl) => ligne.forEach((f, dc) => {
            this.feuille.formules.set(`${this.ligne + dl},${this.colonne + dc}`, f);
            this.feuille.verifierSyntaxe(f, `${this.ligne + dl},${this.colonne + dc}`);
        }));
        return this;
    }
    setWrap() { return this; }
    setVerticalAlignment(a) {
        if (!['top', 'middle', 'bottom'].includes(a)) throw new Error(`Invalid argument: alignment (${a})`);
        return this;
    }
    /** Message du vrai service quand un tableau 2D ne correspond pas à la plage. */
    verifierDimensions(quoi, t) {
        if (!Array.isArray(t) || t.length !== this.hauteur || t.some(l => l.length !== this.largeur)) {
            throw new Error(`The number of rows or columns in the ${quoi} does not match the range.`);
        }
    }
    setNote() { return this; }
    setBorder() { return this; }
    setHorizontalAlignment() { return this; }
    setBackground() { return this; }
    setFontColor() { return this; }
    setFontSize() { return this; }
    setNumberFormat() { return this; }
    setFormula(f) {
        if (typeof f !== 'string' || !f.startsWith('=')) throw new Error('Invalid formula');
        this.feuille.formules.set(`${this.ligne},${this.colonne}`, f);
        this.feuille.verifierSyntaxe(f, `${this.ligne},${this.colonne}`);
        return this;
    }
    setDataValidation(regle) {
        if (regle !== null && !(regle instanceof FausseRegleValidation)) {
            throw new Error('Invalid argument: rule');
        }
        this.feuille.validations.set(`${this.ligne},${this.colonne}`, regle);
        return this;
    }
}

/**
 * Règle de validation de données. Le constructeur n'expose que les méthodes
 * vérifiées sur la documentation de DataValidationBuilder : une méthode
 * inventée lèverait « is not a function », comme le vrai.
 */
class FausseRegleValidation {
    constructor(criteres) { Object.assign(this, criteres); }
    /** Vrai si la valeur passerait la règle. */
    accepte(v) {
        if (this.liste) return this.liste.includes(String(v));
        if (typeof v !== 'number') return false;
        if (this.entre) return v >= this.entre[0] && v <= this.entre[1];
        if (this.auMoins !== undefined) return v >= this.auMoins;
        return true;
    }
}

const nouvelleValidation = () => {
    const criteres = {};
    const constructeur = {
        requireNumberBetween(a, b) { criteres.entre = [a, b]; return constructeur; },
        requireNumberGreaterThanOrEqualTo(n) { criteres.auMoins = n; return constructeur; },
        requireValueInRange() { return constructeur; },
        requireValueInList(liste) {
            if (!Array.isArray(liste) || !liste.length || liste.length > 500) throw new Error('Invalid argument: values');
            criteres.liste = [...liste];
            return constructeur;
        },
        setAllowInvalid(b) { criteres.refuseInvalide = !b; return constructeur; },
        setHelpText(t) { criteres.aide = t; return constructeur; },
        build() { return new FausseRegleValidation({ ...criteres }); }
    };
    return constructeur;
};

class FausseFeuille {
    constructor(nom) {
        this.nom = nom;
        this.cellules = [];
        this.operations = []; // journal des écritures, pour vérifier leur ordre
        this.validations = new Map(); // 'ligne,colonne' → règle de validation
        this.formules = new Map(); // 'ligne,colonne' → formule posée
        this.erreursAnalyse = new Map(); // 'ligne,colonne' → message, comme la cellule #ERROR!
        this.classeur = null;
        this.masquee = false;
        this.maxLignes = 1000; // grille d'un onglet neuf
        this.graphiques = [];
        this.reglesMfc = [];
    }

    getName() { return this.nom; }

    getLastRow() {
        for (let l = this.cellules.length - 1; l >= 0; l -= 1) {
            if ((this.cellules[l] || []).some(v => v !== '' && v !== undefined)) return l + 1;
        }
        return 0;
    }

    getRange(ligne, colonne, hauteur = 1, largeur = 1) {
        if (typeof ligne === 'string') return this.plageA1(ligne);
        if (!(ligne >= 1) || !(colonne >= 1) || !(hauteur >= 1) || !(largeur >= 1)) {
            throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
        }
        return new FaussePlage(this, ligne, colonne, hauteur, largeur);
    }

    /**
     * Reproduit ce qui a été constaté sur un vrai classeur en français : une
     * formule posée par le script y est lue à la française, où « , » est le
     * séparateur décimal. Une virgule hors chaîne y produit une erreur
     * d'analyse, que Sheets affiche dans la cellule sans lever d'exception.
     */
    verifierSyntaxe(f, adresse) {
        const langue = this.classeur ? this.classeur.langue : 'en_US';
        if (/^en(_|$)/i.test(langue)) return;
        if (/,/.test(f.replace(/"(?:[^"]|"")*"/g, '""'))) {
            this.erreursAnalyse.set(adresse, `Erreur d'analyse de formule (langue ${langue}) : ${f}`);
        }
    }

    /** Notation A1 : « B2 », « C13:C42 », « X1:X » (colonne ouverte jusqu'au bas de la grille). */
    plageA1(a1) {
        const col = l => [...l].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
        const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d*))?$/.exec(a1);
        if (!m) throw new Error(`Range not found: ${a1}`);
        const [, c1, l1, c2 = c1, l2 = l1] = m;
        const fin = l2 === '' ? this.maxLignes : Number(l2);
        return this.getRange(Number(l1), col(c1), fin - Number(l1) + 1, col(c2) - col(c1) + 1);
    }
    setFrozenRows() { return this; }
    hideSheet() { this.masquee = true; return this; }
    isSheetHidden() { return this.masquee; }
    getMaxRows() { return this.maxLignes; }
    insertRowsAfter(apres, nombre) {
        if (!(apres >= 1) || apres > this.maxLignes || !(nombre >= 1)) throw new Error('Those rows are out of bounds.');
        this.maxLignes += nombre;
        return this;
    }
    setHiddenGridlines() { return this; }
    setColumnWidth(colonne, largeur) {
        if (!(colonne >= 1) || !(largeur >= 0)) throw new Error('Invalid argument');
        return this;
    }
    setConditionalFormatRules(regles) {
        if (!Array.isArray(regles)) throw new Error('Invalid argument: rules');
        this.reglesMfc = regles;
        return this;
    }
    newChart() {
        const plages = [];
        const constructeur = {
            setChartType(t) { if (!t) throw new Error('Invalid argument: type'); return constructeur; },
            setNumHeaders() { return constructeur; },
            setPosition() { return constructeur; },
            setOption() { return constructeur; },
            addRange(p) { plages.push(p); return constructeur; },
            build() { return { plages }; }
        };
        return constructeur;
    }
    insertChart(g) { this.graphiques.push(g); return this; }

    /** Comme le vrai : interprète les valeurs comme setValues, ajoute après la dernière ligne. */
    appendRow(valeurs) {
        if (!Array.isArray(valeurs)) throw new Error('Invalid argument: rowContents');
        this.getRange(this.getLastRow() + 1, 1, 1, valeurs.length).setValues([valeurs]);
        return this;
    }

    deleteRows(position, nombre) {
        if (!(position >= 1) || !(nombre >= 1) || position + nombre - 1 > this.cellules.length) {
            throw new Error('Those rows are out of bounds.');
        }
        this.operations.push(['deleteRows', position, nombre]);
        this.cellules.splice(position - 1, nombre);
        return this;
    }

    /** Toutes les lignes de données, en-tête exclu, sur `largeur` colonnes (14 pour Rapports, 15 pour Enregistrements). */
    lignes(largeur = 15) { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), largeur).getValues().slice(1); }
}

class FauxClasseur {
    /** Français par défaut : c'est la langue du classeur réel qui a révélé le défaut. */
    constructor(langue = 'fr_FR') {
        this.feuilles = new Map(); this.active = null; this.langue = langue;
        this.historiqueLangues = [langue];
    }
    getSpreadsheetLocale() { return this.langue; }
    setSpreadsheetLocale(langue) {
        if (typeof langue !== 'string' || !/^[a-z]{2}(_[A-Z]{2})?$/.test(langue)) {
            throw new Error(`Invalid argument: locale (${langue})`);
        }
        this.langue = langue;
        this.historiqueLangues.push(langue);
    }
    getSheetByName(nom) { return this.feuilles.get(nom) || null; }
    getSheets() { return [...this.feuilles.values()]; }
    insertSheet(nom) {
        if (this.feuilles.has(nom)) {
            throw new Error(`A sheet with the name "${nom}" already exists. Please enter another name.`);
        }
        const feuille = new FausseFeuille(nom);
        feuille.classeur = this;
        this.feuilles.set(nom, feuille);
        return feuille;
    }
    deleteSheet(feuille) {
        if (!this.feuilles.has(feuille.getName())) throw new Error('Sheet not found');
        if (this.feuilles.size === 1) throw new Error('You can\'t remove all the sheets in a document.');
        this.feuilles.delete(feuille.getName());
    }
    setActiveSheet(feuille) { this.active = feuille; return feuille; }
}

/* --------------------------------------------------------------------------
 * Blobs, Utilities
 * ----------------------------------------------------------------------- */

class FauxBlob {
    constructor({ nom = null, type = null, octets = Buffer.alloc(0), entrees = null }) {
        Object.assign(this, { nom, type, octets, entrees });
    }
    getName() { return this.nom; }
    setName(nom) { this.nom = nom; return this; }
    getContentType() { return this.type; }
    setContentType(type) { this.type = type; return this; }
    copyBlob() { return new FauxBlob({ ...this }); }
    getDataAsString() { return this.octets.toString('utf8'); }
}

const blobXml = (nom, xml, type = 'text/xml') => new FauxBlob({ nom, type, octets: Buffer.from(xml, 'utf8') });
const blobGzip = (nom, xml, type = 'application/gzip') =>
    new FauxBlob({ nom, type, octets: zlib.gzipSync(Buffer.from(xml, 'utf8')) });
const blobZip = (nom, fichiers, type = 'application/zip') =>
    new FauxBlob({ nom, type, entrees: fichiers.map(([n, x]) => blobXml(n, x, null)) });

const Utilities = {
    ungzip(blob) {
        if (blob.getContentType() !== 'application/x-gzip') {
            throw new Error('Could not decompress gzip.');
        }
        return new FauxBlob({ octets: zlib.gunzipSync(blob.octets) });
    },
    unzip(blob) {
        if (blob.getContentType() !== 'application/zip' || !blob.entrees) {
            throw new Error('Could not unzip file.');
        }
        return blob.entrees.map(e => e.copyBlob());
    },
    pauses: [],
    /** Comme le vrai : 0 à 300 000 ms. Consigné, sans attendre réellement. */
    sleep(ms) {
        if (!(ms >= 0 && ms <= 300000)) throw new Error('Invalid argument: milliseconds');
        Utilities.pauses.push(ms);
    },
    formatDate(date, fuseau, motif) {
        if (!fuseau) throw new Error('Invalid argument: timeZone');
        if (motif !== 'yyyyMMdd_HHmmss') throw new Error(`Motif non simulé : ${motif}`);
        const p = n => String(n).padStart(2, '0');
        return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}_`
            + `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
    },
    newBlob(texte, type, nom) {
        if (!nom) throw new Error('Blob name is required.');
        return blobXml(nom, texte, type);
    }
};

/* --------------------------------------------------------------------------
 * XmlService — analyseur minimal, suffisant pour des rapports DMARC
 * ----------------------------------------------------------------------- */

class FauxElement {
    constructor(nom, espace) {
        Object.assign(this, { nom, espace, enfants: [], texte: '' });
    }
    getNamespace() { return { uri: this.espace }; }
    getChild(nom, ns) { return this.getChildren(nom, ns)[0] || null; }
    getChildren(nom, ns) {
        const uri = ns ? ns.uri : '';
        return this.enfants.filter(e => e.nom === nom && e.espace === uri);
    }
    getText() {
        const entites = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
        return this.texte.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => entites[e]);
    }
}

const analyserXml = (texte) => {
    const source = texte.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    const jeton = /<\/?([A-Za-z_][\w.-]*)([^>]*?)(\/?)>|([^<]+)/g;
    const pile = [];
    let racine = null;
    let m;
    while ((m = jeton.exec(source))) {
        const [brut, nom, attributs, autoFermant, texteLibre] = m;
        if (texteLibre !== undefined) {
            if (texteLibre.trim() && !pile.length) throw new Error('Content is not allowed in prolog.');
            if (pile.length) pile[pile.length - 1].texte += texteLibre;
            continue;
        }
        if (brut.startsWith('</')) {
            const ouvert = pile.pop();
            if (!ouvert || ouvert.nom !== nom) {
                throw new Error(`The element type "${ouvert ? ouvert.nom : nom}" must be terminated `
                    + `by the matching end-tag "</${ouvert ? ouvert.nom : nom}>".`);
            }
            continue;
        }
        const xmlns = /xmlns="([^"]*)"/.exec(attributs);
        const parent = pile[pile.length - 1];
        const element = new FauxElement(nom, xmlns ? xmlns[1] : (parent ? parent.espace : ''));
        if (parent) parent.enfants.push(element);
        else if (racine) throw new Error('The markup in the document following the root element must be well-formed.');
        else racine = element;
        if (!autoFermant) pile.push(element);
    }
    if (!racine || pile.length) throw new Error('XML document structures must start and end within the same entity.');
    return racine;
};

const XmlService = {
    parse(texte) {
        const racine = analyserXml(texte);
        return { getRootElement: () => racine };
    }
};

/* --------------------------------------------------------------------------
 * Gmail, Drive
 * ----------------------------------------------------------------------- */

class FauxMessage {
    constructor(sujet, pieces, fil = null) {
        Object.assign(this, { sujet, pieces, fil, corbeille: false });
    }
    getSubject() { return this.sujet; }
    getAttachments() { return this.pieces; }
    isInTrash() { return this.corbeille; }
    moveToTrash() {
        this.corbeille = true;
        if (this.fil && this.fil.messages.every(m => m.corbeille)) {
            this.fil.corbeille = true;
        }
        return this;
    }
}

let compteurFils = 0;

class FauxFil {
    constructor(messages) {
        compteurFils += 1;
        this.id = `fil-${compteurFils}`;
        this.messages = messages;
        this.messages.forEach(m => { m.fil = this; });
        this.corbeille = false;
        this.libelles = [];
    }
    getId() { return this.id; }
    getMessages() { return this.messages; }
    isInTrash() { return this.corbeille; }
    moveToTrash() {
        this.corbeille = true;
        this.messages.forEach(m => { m.corbeille = true; });
        return this;
    }
    addLabel(libelle) { this.libelles.push(libelle.getName()); return this; }
}

class FauxGmail {
    constructor() {
        this.fils = [];
        this.libelles = new Map();
        this.recherches = [];
        this.indexEnRetard = false; // simule un index qui voit encore la corbeille
    }
    ajouterFil(...messages) {
        const fil = new FauxFil(messages);
        this.fils.push(fil);
        return fil;
    }
    search(requete, debut, max) {
        if (max > 500) throw new Error('Argument max cannot exceed 500.');
        this.recherches.push(requete);
        const labelsExclus = [...requete.matchAll(/-label:(\S+)/g)].map(m => m[1]);
        return this.fils
            .filter(f => this.indexEnRetard || (!f.corbeille && !labelsExclus.some(l => f.libelles.includes(l))))
            .slice(debut, debut + max);
    }
    getUserLabelByName(nom) { return this.libelles.get(nom) || null; }
    createLabel(nom) {
        const libelle = { getName: () => nom };
        this.libelles.set(nom, libelle);
        return libelle;
    }
}

/** DriveApp.Permission — énumération recopiée de la documentation, rien d'inventé. */
const PERMISSIONS = Object.freeze({ VIEW: 'VIEW', EDIT: 'EDIT', COMMENT: 'COMMENT', OWNER: 'OWNER',
    ORGANIZER: 'ORGANIZER', FILE_ORGANIZER: 'FILE_ORGANIZER', NONE: 'NONE' });

class FauxDossier {
    constructor() {
        this.fichiers = []; this.contenus = new Map(); this.enPanne = false;
        this.droit = PERMISSIONS.EDIT; // réglable par un test
    }
    getName() { return 'Archives DMARC'; }
    getAccess() { return this.droit; }
    createFile(blob) {
        if (this.enPanne) throw new Error('Service error: Drive');
        this.fichiers.push(blob.getName());
        this.contenus.set(blob.getName(), blob.getDataAsString());
        return blob;
    }
}

class FaussesProprietes {
    constructor(initial = {}) { this.props = new Map(Object.entries(initial)); }
    getProperty(cle) { return this.props.has(cle) ? this.props.get(cle) : null; }
    setProperty(cle, val) { this.props.set(cle, String(val)); return this; }
    setProperties(obj) { Object.entries(obj).forEach(([k, v]) => this.props.set(k, String(v))); return this; }
    getProperties() { const o = {}; this.props.forEach((v, k) => { o[k] = v; }); return o; }
    deleteProperty(cle) { this.props.delete(cle); return this; }
}

/* --------------------------------------------------------------------------
 * Assemblage
 * ----------------------------------------------------------------------- */

const ID_DOSSIER_TEST = 'dossier-test-id';

/**
 * Zone DNS par défaut du faux DoH. Trois cas qui comptent :
 *   - 1.2.3.4 : PTR vers mail-ej1.google.com, qui résout bien vers 1.2.3.4 ;
 *   - 6.6.6.6 : PTR vers mail.google.com — nom usurpé, qui résout ailleurs ;
 *   - 2001:db8::25 : IPv6 avec PTR confirmé.
 */
const ZONE_DNS_DEFAUT = {
    '4.3.2.1.in-addr.arpa': { PTR: ['mail-ej1.google.com.'] },
    'mail-ej1.google.com': { A: ['1.2.3.4'] },
    '6.6.6.6.in-addr.arpa': { PTR: ['mail.google.com.'] },
    'mail.google.com': { A: ['142.250.0.1'] },
    '5.2.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa': { PTR: ['mx.exemple.fr.'] },
    'mx.exemple.fr': { AAAA: ['2001:0db8:0000:0000:0000:0000:0000:0025'] }
};
const TYPES_DNS = { A: 1, PTR: 12, AAAA: 28 };

/** Portées OAuth déclarées par le manifeste du projet. */
const porteesDuManifeste = () => {
    const manifeste = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'appsscript.json'), 'utf8'));
    return manifeste.oauthScopes || [];
};

/** Message que lève Apps Script quand une portée manque au manifeste. */
const refusPortee = (methode, portee) => new Error(`You do not have permission to call ${methode}. `
    + `Required permissions: https://www.googleapis.com/auth/${portee}`);

const construireSandbox = ({
    email = 'dmarc-bot@example.com',
    proprietesScript = { DRIVE_FOLDER_ID: ID_DOSSIER_TEST },
    portees = porteesDuManifeste(),
    zoneDns = ZONE_DNS_DEFAUT
} = {}) => {
    const classeur = new FauxClasseur();
    const gmail = new FauxGmail();
    const dossier = new FauxDossier();
    const verrou = { libre: true, tryLock() { return this.libre; }, releaseLock() {} };
    const scriptProps = new FaussesProprietes(proprietesScript);
    const userProps = new FaussesProprietes();
    const journal = [];
    const emailsEnvoyes = [];
    const requetesHttp = [];
    // Réglages modifiables par un test : panne DNS, code HTTP du webhook.
    const reseau = { dnsEnPanne: false, codeWebhook: 200 };
    const aPortee = nom => portees.includes(`https://www.googleapis.com/auth/${nom}`);

    const urlFetch = {
        fetch(url, options = {}) {
            if (!aPortee('script.external_request')) throw refusPortee('UrlFetchApp.fetch', 'script.external_request');
            requetesHttp.push({ url, options });
            if (url.startsWith('https://dns.google/resolve')) {
                if (reseau.dnsEnPanne) return { getResponseCode: () => 502, getContentText: () => 'Bad Gateway' };
                const params = new URL(url).searchParams;
                const nom = params.get('name').replace(/\.$/, '');
                const type = params.get('type');
                const enregistrements = zoneDns[nom];
                const corps = !enregistrements
                    ? { Status: 3 }
                    : { Status: 0, Answer: (enregistrements[type] || []).map(data => ({ name: nom, type: TYPES_DNS[type], data })) };
                return { getResponseCode: () => 200, getContentText: () => JSON.stringify(corps) };
            }
            const code = reseau.codeWebhook;
            if (code >= 400 && !options.muteHttpExceptions) {
                throw new Error(`Request failed for ${url} returned code ${code}`);
            }
            return { getResponseCode: () => code, getContentText: () => '' };
        }
    };

    const mailApp = {
        sendEmail(options) {
            if (!aPortee('script.send_mail')) throw refusPortee('MailApp.sendEmail', 'script.send_mail');
            if (!options || !options.to || !options.subject) throw new Error('Invalid argument: recipient');
            emailsEnvoyes.push(options);
        }
    };

    const sandbox = {
        console: {
            log: (...a) => journal.push(['log', a.join(' ')]),
            error: (...a) => journal.push(['error', a.join(' ')])
        },
        Session: {
            getEffectiveUser: () => ({ getEmail: () => email }),
            getScriptTimeZone: () => 'Europe/Paris'
        },
        LockService: { getScriptLock: () => verrou },
        SpreadsheetApp: {
            getActiveSpreadsheet: () => classeur,
            newDataValidation: nouvelleValidation,
            newConditionalFormatRule: () => {
                const regle = {};
                const constructeur = {
                    whenFormulaSatisfied(f) { regle.formule = f; return constructeur; },
                    setBackground(c) { regle.fond = c; return constructeur; },
                    setRanges(p) { regle.plages = p; return constructeur; },
                    build() {
                        if (!regle.formule || !regle.plages) throw new Error('Rule is incomplete');
                        return regle;
                    }
                };
                return constructeur;
            },
            BorderStyle: Object.freeze({ SOLID: 'SOLID' }),
            flush() {},
            getUi() {
                return {
                    alert: (msg) => { journal.push(['alert', msg]); },
                    prompt: () => ({ getSelectedButton: () => 'CANCEL', getResponseText: () => '' }),
                    createMenu: () => {
                        const chaine = {
                            addItem() { return chaine; },
                            addSeparator() { return chaine; },
                            addToUi() {}
                        };
                        return chaine;
                    },
                    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
                    Button: { OK: 'OK', CANCEL: 'CANCEL' }
                };
            }
        },
        // Seul l'ID du faux dossier existe : un ID inconnu lève, comme le vrai
        // service. Un faux qui rendrait un dossier pour n'importe quel ID
        // cacherait tout défaut de configuration.
        DriveApp: {
            Permission: PERMISSIONS,
            getFolderById(id) {
                if (!id) throw new Error('Invalid argument: id');
                if (id !== ID_DOSSIER_TEST) {
                    throw new Error('No item with the given ID could be found, or you do not have '
                        + 'permission to access it.');
                }
                return dossier;
            }
        },
        PropertiesService: {
            getScriptProperties: () => scriptProps,
            getUserProperties: () => userProps
        },
        Charts: { ChartType: Object.freeze({ BAR: 'BAR', LINE: 'LINE', PIE: 'PIE', COLUMN: 'COLUMN' }) },
        GmailApp: gmail,
        UrlFetchApp: urlFetch,
        MailApp: mailApp,
        Utilities,
        XmlService
    };
    return { sandbox, classeur, gmail, dossier, verrou, scriptProps, userProps, journal, emailsEnvoyes, requetesHttp, reseau };
};

module.exports = { construireSandbox, blobXml, blobGzip, blobZip, FauxMessage, Formule, FaussesProprietes };
