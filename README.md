# Rapports DMARC / DMARC Reports

[🇫🇷 Version française](#-version-française) | [🇬🇧 English version](#-english-version)

[![Version](https://img.shields.io/badge/version-1.9.0-blue.svg)](CHANGELOG.md)
[![License: Elastic-2.0](https://img.shields.io/badge/License-Elastic--2.0-orange.svg)](LICENSE)
[![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?logo=google&logoColor=white)](https://developers.google.com/apps-script)
[![Google Sheets](https://img.shields.io/badge/Google%20Sheets-34A853?logo=googlesheets&logoColor=white)](https://workspace.google.com/products/sheets/)
[![Tests](https://img.shields.io/badge/tests-120%2F120%20pass-brightgreen)](banc/test.js)

---

## 🇫🇷 Version française

Script Google Apps Script **lié à un classeur Google Sheets** qui relève automatiquement les rapports DMARC agrégés (`rua`) arrivés dans la boîte Gmail d'un compte technique, extrait les données XML, enrichit les adresses IP sources via DNS-over-HTTPS (DoH), surveille les anomalies avec alertes proactives, gère la rétention historique avec export CSV sécurisé et présente les indicateurs clés dans un tableau de bord interactif.

Pour le guide pas à pas d'installation et de mise en route, consultez [DEMARRAGE.md](DEMARRAGE.md).

> **Vous débutez avec SPF, DKIM et DMARC ?** Commencez par [COMPRENDRE-DMARC.md](COMPRENDRE-DMARC.md) : les deux expéditeurs d'un e-mail, l'alignement, la lecture d'un rapport, le parcours de `p=none` à `p=reject`, et que faire d'une source non conforme.

### Fonctionnalités principales

1. **Relève et ingestion automatique** :
   - Surveillance Gmail ciblée (`deliveredto:`), décompression des pièces jointes `.zip`, `.gz` ou `.xml` (RFC 7489, avec ou sans namespace XML).
   - Archivage du XML brut dans un dossier Google Drive dédié (facultatif mais recommandé).
   - Écriture groupée par lot dans les onglets `Rapports` et `Enregistrements` avec protection contre l'injection de formules (`celluleTexte_`).
   - Gestion résiliente des erreurs : étiquetage `DMARC-Erreur` sur les fils à problème sans bloquer les rapports valides.
   - **Dédoublonnage par émetteur et identifiant** (colonne `cle` = `émetteur|report_id`, depuis la v1.6.0). Le `report_id` n'est unique que chez un même émetteur (RFC 7489) : deux émetteurs au même identifiant ne se confondent plus, ni à l'enregistrement, ni dans le tableau de bord, les alertes ou la purge.

2. **Résolution DNS inverse DoH et identification d'opérateurs** :
   - Enrichissement automatique des adresses IP non conformes via DNS-over-HTTPS (Google Public DNS, `dns.google` ; les IP sources lui sont donc transmises).
   - Validation FCrDNS (Forward-Confirmed reverse DNS) pour détecter et neutraliser les usurpations de noms d'hôte.
   - Reconnaissance des grands opérateurs d'envoi (Google, Microsoft, SendGrid, Mailchimp, Brevo, OVH, Amazon SES…) d'après un nom d'hôte **vérifié** ; un nom non confirmé s'affiche « NON VÉRIFIÉ » et n'est rattaché à aucun opérateur.
   - Cache persistant dans l'onglet masqué `_CacheIP` pour minimiser les requêtes réseau et préserver les quotas d'exécution Apps Script.

3. **Détection proactive d'anomalies et alertes multicanales** :
   - Détection, domaine par domaine et sur les rapports reçus en 24 h, des chutes de conformité (`SEUIL_ALERTE_CONFORMITE`) et des pics de rejets (`SEUIL_ALERTE_REJETS`) ; l'alerte indique la période que couvrent ces rapports.
   - Alerte de silence : un domaine qui ne reçoit plus aucun rapport depuis `JOURS_SANS_RAPPORT_ALERTE` jours (DNS supprimé, adresse `rua` cassée).
   - Notifications envoyées par courriel (`MailApp.sendEmail`) et/ou webhook HTTPS (Google Chat, Slack, Discord).
   - Courriel mis en forme (depuis la v1.9.0) : une carte par anomalie, colorée selon sa gravité, avec le constat, la marche à suivre et les principales sources ; un bouton ouvre le classeur. Le pied de page donne le produit, l'auteur, son site et la version qui a tourné. Une version texte accompagne toujours le HTML, et les valeurs venues des rapports y sont échappées.
   - Période de carence (cooldown) de 24 h par domaine et par type d'alerte consignée dans `ScriptProperties` pour prévenir tout spam.
   - Lecture optimisée depuis le bas de l'onglet `Enregistrements` sans charger l'historique complet.

4. **Rétention glissante et purge sécurisée par export CSV** :
   - Purge configurable des données plus anciennes que `JOURS_RETENTION` (180 jours par défaut).
   - Sauvegarde préalable obligatoire sous forme de fichiers CSV horodatés dans Drive avant toute suppression.
   - Neutralisation des formules CSV (`celluleCsv_`) pour prévenir les attaques par injection lors de l'ouverture sous Excel ou Sheets.
   - Transaction robuste : réécriture des données conservées avant purge pour éviter tout état incohérent ou vide.

5. **Tableau de bord et aide à la décision « Prêt pour p=reject »** :
   - Diagnostic dynamique évaluant l'éligibilité du domaine au durcissement de politique (`p=quarantine` puis `p=reject`) selon le seuil `SEUIL_PRET_REJECT`.
   - Top 15 des sources non conformes avec nom d'hôte vérifié lié en direct au cache.
   - **Diagnostic DKIM des non conformes** (v1.7.0) : « DKIM cassé » (signé par votre domaine puis modifié en route : message légitime abîmé par un intermédiaire du destinataire), « DKIM absent » (usurpation probable), « DKIM d'un tiers » (à examiner), « DKIM non renseigné » (l'émetteur du rapport ne détaille pas DKIM). Il apparaît dans le Top 15 et dans un tableau de synthèse.
   - Graphiques d'évolution temporelle et répartition de conformité par domaine.
   - Filtre « Période » aligné sur la rétention : les choix ne dépassent ni `JOURS_RETENTION` ni les 500 jours du graphique, et se mettent à jour à chaque passage horaire.
   - **Fonctionne dans un classeur en français comme en anglais.** Un classeur en français lit à la française les formules posées par le script (`;` entre les arguments, `,` décimale). Le script le passe donc en `en_US` le temps de poser ses formules, puis rétablit sa langue, même en cas d'erreur ; Sheets retraduit alors lui-même les formules (`SI`, `RECHERCHEV`, `;`…). Cela ne dure que quelques secondes, et seulement à la création du tableau de bord. Un classeur déjà en anglais n'est pas touché.
   - Les calculs vivent dans l'onglet masqué `_Données` (bouton ☰ en bas à gauche pour l'afficher) : ne le supprimez pas.
   - **Onglet « Aide »** (menu *DMARC > Aide*) : SPF, DKIM et DMARC expliqués aux débutants, le rôle de chaque onglet et des libellés Gmail, et les vérifications du quotidien. Il est régénéré automatiquement à chaque nouvelle version.

6. **Onglet « Paramètres » dynamique** :
   - Centralisation des seuils de conformité, volumes minimaux et délais de rétention directement modifiables par l'utilisateur.
   - Chaque cellule de valeur porte une validation de données dérivée des bornes que le code applique : une saisie hors bornes (95 au lieu de 0,95) est refusée à la frappe. Couleurs des taux, diagnostic et alertes lisent les mêmes seuils.

7. **Onglet « Domaines » (v1.3.0, adresses depuis la v1.4.0)** :
   - Colonne `adresse_rua` : les adresses de réception des rapports, qui composent la recherche Gmail. Elles ne sont plus dans le code et se modifient sans déploiement. Une adresse mal formée est ignorée et signalée ; sans aucune adresse, rien n'est relevé.
   - Seuls les rapports des domaines listés, et de leurs sous-domaines, sont enregistrés. L'adresse `rua` est publique et un rapport DMARC n'est pas authentifié : cette liste écarte les domaines inventés.
   - Un rapport hors liste n'est ni archivé ni enregistré ; son fil est conservé sous le libellé `DMARC-Hors-liste`, jamais mis à la corbeille. Domaine oublié : on l'ajoute, on retire le libellé, rien n'est perdu.
   - Prérempli à la création avec les domaines déjà connus, marqués « à vérifier ». Liste vide : aucun filtrage, et le bilan le dit.

8. **Onglet « Journal » (v1.3.0)** :
   - Bilan horodaté de chaque passage (déclencheur, menu, purge), passages sautés et échecs compris ; borné à 500 lignes.
   - En tête du tableau de bord : heure du dernier passage et du dernier rapport enregistré. Un dernier passage de plus d'une heure signale un déclencheur arrêté.

9. **Contrôle des enregistrements DNS (v1.8.0)** :
   - Pour chaque domaine de l'onglet **Domaines** : **DMARC** (présent, unique, politique, rapports bien envoyés à une adresse relevée par l'outil, autorisation d'un domaine externe de réception), **SPF** (unique, **nombre de consultations DNS** `include:` imbriqués compris, limite de 10, terminaison `-all` / `~all` / `?all` / `+all`), **DKIM** (clés publiées pour les sélecteurs courants ou ceux de la colonne `selecteurs_dkim`, clés révoquées).
   - Résultat dans l'onglet **Contrôle DNS** : un statut par point (OK, Info, Attention, Problème), le constat et la marche à suivre. Une panne DNS donne « Non vérifié », jamais « Problème ».
   - Refait chaque jour par le traitement horaire, et à la demande : *DMARC > Contrôler les enregistrements DNS*.

### Prérequis

- Un compte Google Workspace technique dédié (ex. `dmarc-bot@example.com`) recevant les flux `rua`.
- Un classeur Google Sheets lié au projet Apps Script.
- Facultatif : Un dossier Google Drive pour l'archivage des XML bruts et des sauvegardes CSV de purge.
- Facultatif : Une URL de webhook HTTPS pour les alertes (Google Chat, Slack, Discord).

### Installation et configuration rapide

1. Créez un classeur Google Sheets connecté avec le compte technique.
2. Ouvrez *Extensions > Apps Script*, supprimez le fichier `Code.gs` par défaut et importez les fichiers `.gs` du projet ainsi que le fichier `appsscript.json`.
3. Dans [DmarcConfig.gs](DmarcConfig.gs), renseignez `COMPTE_TECHNIQUE`. Les adresses de réception se renseignent dans l'onglet **Domaines**, colonne `adresse_rua`, que crée le premier traitement.
4. Rechargez le classeur Sheets, puis utilisez le menu **DMARC**, dans cet ordre (détail dans [DEMARRAGE.md](DEMARRAGE.md)) :
   1. *DMARC > Configurer le dossier d'archivage Drive* (collez l'identifiant du dossier Drive).
   2. *DMARC > Traiter les rapports maintenant* : ce premier passage crée l'onglet **Domaines** et s'arrête, faute d'adresse.
   3. Remplissez l'onglet **Domaines** : vos adresses de réception (colonne `adresse_rua`) et vos domaines (colonne `domaine`).
   4. *DMARC > Traiter les rapports maintenant*, de nouveau : les rapports sont relevés.
   5. *DMARC > Créer / réinitialiser le tableau de bord*.
   6. *DMARC > Configurer les alertes proactives*.
   7. *DMARC > Activer le traitement horaire* (automatisation).

### Mise à jour du code

1. Dans l'éditeur Apps Script, remplacez le contenu de chaque fichier `Dmarc*.gs` et de `appsscript.json` ; ajoutez les fichiers nouveaux. Un script lié exécute toujours le code présent dans l'éditeur : il n'y a pas de déploiement à faire.
2. *DMARC > À propos* doit afficher la version attendue ; sinon, un fichier n'a pas été remplacé.
3. Lisez l'entrée correspondante du [CHANGELOG](CHANGELOG.md) : quand elle le demande, recréez le tableau de bord (*DMARC > Créer / réinitialiser le tableau de bord*).
4. Certaines versions migrent les données existantes au premier passage (par exemple la 1.6.0, qui ajoute la colonne `cle`). La migration est automatique, se fait une seule fois, et le bilan du passage (onglet Journal) indique ce qu'elle a fait.

### Portées OAuth (appsscript.json)

| Portée | Rôle |
| --- | --- |
| `mail.google.com` | Recherche, étiquetage et mise à la corbeille des fils de rapports dans Gmail. Aucune suppression définitive. |
| `drive` | Écriture des archives XML brutes et des exports CSV de purge dans le dossier configuré. |
| `spreadsheets.currentonly` | Accès exclusif au classeur lié courant (principe du moindre privilège). |
| `script.send_mail` | Envoi d'alertes proactives en cas d'anomalie de conformité ou pic de rejets. |
| `script.external_request` | Résolution DNS-over-HTTPS (`dns.google`) et envoi de webhooks d'alerte. |
| `script.container.ui` | Affichage des boîtes de dialogue et des menus personnalisés. |
| `script.scriptapp` | Gestion automatique du déclencheur horaire. |
| `userinfo.email` | Vérification stricte que l'exécuteur est bien le compte technique. |

### Structure du projet

```
DmarcConfig.gs          Configuration globale, version et constantes
DmarcParametres.gs      Gestion de l'onglet « Paramètres » éditable
DmarcEnrichissement.gs  Résolution DNS DoH inverse (PTR FCrDNS), opérateurs, cache
DmarcAlertes.gs         Détection d'anomalies, cooldown 24h, courriels et webhooks
DmarcRetention.gs       Purge glissante et export CSV sécurisé
DmarcTraitement.gs      Boucle Gmail, traitement par lot et résilience des fils
DmarcRapport.gs         Décompression (zip, gz) et analyse XML (RFC 7489)
DmarcFeuilles.gs        Gestion des onglets, permissions et écriture protégée
DmarcTableauDeBord.gs   Construction du tableau de bord, diagnostic et graphiques
DmarcMenu.gs            Menus personnalisés, déclencheurs et dialogue À propos
DmarcDomaines.gs        Onglet « Domaines » : adresses de réception et domaines acceptés
DmarcJournal.gs         Onglet « Journal » : bilan horodaté de chaque passage
DmarcAide.gs            Onglet « Aide » : DMARC expliqué aux débutants, rôle de chaque onglet
DmarcDns.gs             Contrôle des enregistrements DMARC, SPF et DKIM de chaque domaine
appsscript.json         Manifeste de l'application et portées OAuth minimales
banc/
  faux-google.js        Simulateur des services Google (Sheets, Gmail, Drive, UrlFetch...)
  test.js               Banc de tests unitaires automatisés Node.js (120 cas)
DEMARRAGE.md            Guide pas à pas de démarrage
COMPRENDRE-DMARC.md     Guide pour débutants : SPF, DKIM, DMARC et lecture des rapports
demo/                   Jeu de démonstration fictif (générateur, CSV à importer, chiffres attendus)
CHANGELOG.md            Historique des versions
```

### Banc d'essai automatisé

L'ensemble de la logique métier (parsing XML, batching Sheets, pagination Gmail, DoH, FCrDNS, alertes, purge CSV, formules du tableau de bord) est validé par un banc de tests sans dépendances externes :

```bash
node banc/test.js
```

Vérification de la syntaxe Apps Script d'un seul tenant :

```bash
cat Dmarc*.gs > /tmp/projet.js && node --check /tmp/projet.js && rm /tmp/projet.js
```

---

## 🇬🇧 English version

A **Google Sheets bound** Google Apps Script project that automatically ingests aggregate DMARC reports (`rua`) received by a dedicated technical Gmail account, parses XML data, enriches source IP addresses via DNS-over-HTTPS (DoH), monitors anomalies with proactive multi-channel alerts, manages data retention with secure CSV backups, and delivers an interactive analytics dashboard.

For step-by-step setup instructions, please refer to [DEMARRAGE.md](DEMARRAGE.md).

> **New to SPF, DKIM and DMARC?** Start with [COMPRENDRE-DMARC.md](COMPRENDRE-DMARC.md) (in French): the two senders of an e-mail, alignment, reading a report, the path from `p=none` to `p=reject`, and what to do with a non-compliant source.

### Key Features

1. **Automated Ingestion & Parsing**:
   - Targeted Gmail search query (`deliveredto:`), decompression of `.zip`, `.gz`, or `.xml` attachments (RFC 7489, with or without XML namespaces).
   - Raw XML file archiving into a designated Google Drive folder (optional but recommended).
   - Batch writing into `Rapports` and `Enregistrements` sheets with built-in CSV/Formula injection protection (`celluleTexte_`).
   - Resilient error handling: flags problematic threads with `DMARC-Erreur` without blocking valid reports.
   - **Deduplication by reporter and report ID** (`cle` column = `reporter|report_id`, since v1.6.0). A `report_id` is only unique per reporter (RFC 7489): two reporters sharing an ID are no longer confused, whether at ingestion, in the dashboard, alerts or purge.

2. **DoH Reverse DNS Resolution & Provider Identification**:
   - Automatic reverse DNS enrichment of non-compliant source IPs via DNS-over-HTTPS (Google Public DNS, `dns.google`; source IPs are therefore sent to it).
   - Forward-Confirmed reverse DNS (FCrDNS) verification to detect and prevent spoofed hostnames.
   - Recognition of major sending providers (Google, Microsoft, SendGrid, Mailchimp, Brevo, OVH, Amazon SES…) from a **verified** hostname only; an unconfirmed name is shown as « NON VÉRIFIÉ » and attributed to no provider.
   - Persistent caching in the hidden `_CacheIP` sheet to minimize external network requests and protect execution quotas.

3. **Proactive Anomaly Detection & Multi-Channel Alerts**:
   - Per-domain detection, over reports received in the last 24 h, of compliance drops (`SEUIL_ALERTE_CONFORMITE`) and rejection spikes (`SEUIL_ALERTE_REJETS`); the alert states the period those reports cover.
   - Silence alert: a domain that has received no report for `JOURS_SANS_RAPPORT_ALERTE` days (deleted DNS record, broken `rua` address).
   - Notifications dispatched via email (`MailApp.sendEmail`) and/or HTTPS webhooks (Google Chat, Slack, Discord).
   - Formatted email (since v1.9.0): one card per anomaly, coloured by severity, with the finding, the next step and the main sources; a button opens the spreadsheet. The footer shows the product, its author, the author's website and the running version. A plain-text version always accompanies the HTML, and values taken from reports are escaped.
   - 24-hour cooldown per domain and alert type tracked in `ScriptProperties` to prevent alert fatigue.
   - Optimized bottom-up scanning of the `Enregistrements` sheet without reading entire historical data.

4. **Rolling Retention & Secure CSV Purge**:
   - Configurable archiving and purging of data older than `JOURS_RETENTION` (default: 180 days).
   - Mandatory timestamped CSV backup saved to Drive prior to any row deletion.
   - Formula injection neutralization (`celluleCsv_`) for safe handling in Excel/Sheets.
   - Robust atomic transaction pattern (rewriting kept rows before clearing historical range).

5. **Analytics Dashboard & "Reject Readiness" Decision Diagnostic**:
   - Dynamic diagnostic assessing whether a selected domain is ready to safely transition from `p=none` to `p=quarantine` or `p=reject` based on `SEUIL_PRET_REJECT`.
   - Top 15 non-compliant sources table featuring live hostnames from the DoH cache.
   - **DKIM diagnosis of non-compliant messages** (v1.7.0): "DKIM cassé" (signed by your domain then altered in transit: legitimate mail damaged by a recipient-side relay), "DKIM absent" (likely spoofing), "DKIM d'un tiers" (to review), "DKIM non renseigné" (the reporter does not detail DKIM). Shown in the Top 15 and in a summary table.
   - Trend charts and per-domain compliance breakdown.
   - "Période" filter aligned with retention: its choices never exceed `JOURS_RETENTION` nor the chart's 500 days, and are refreshed on every hourly run.
   - **Works in both French- and English-locale spreadsheets.** A French-locale spreadsheet reads script-set formulas the French way (`;` between arguments, `,` as decimal separator). The script therefore switches the spreadsheet to `en_US` while writing its formulas, then restores the original locale, even on error; Sheets then translates the formulas itself. This lasts a few seconds, only when the dashboard is created. An English-locale spreadsheet is left untouched.
   - Calculations live in the hidden `_Données` sheet (☰ button, bottom left, to show it): do not delete it.
   - **"Aide" sheet** (*DMARC > Aide* menu): SPF, DKIM and DMARC explained for beginners, the role of every sheet and Gmail label, and day-to-day checks (in French). Automatically regenerated with each new version.

6. **Configurable "Paramètres" Sheet**:
   - Easily modify thresholds, minimum sample volumes, and retention settings directly from a user-friendly sheet.
   - Each value cell carries data validation derived from the bounds the code enforces: out-of-range input (95 instead of 0.95) is rejected on entry. Rate colours, diagnostic and alerts read the same thresholds.

7. **"Domaines" Sheet (v1.3.0, addresses since v1.4.0)**:
   - `adresse_rua` column: the report reception addresses that build the Gmail search. No longer in the code, editable without redeploying. A malformed address is ignored and reported; with no address at all, nothing is fetched.
   - Only reports for listed domains (and their subdomains) are recorded. The `rua` address is public and DMARC reports are unauthenticated: this list keeps invented domains out.
   - An off-list report is neither archived nor recorded; its thread is kept under the `DMARC-Hors-liste` label, never trashed. Forgot a domain? Add it, remove the label, nothing is lost.
   - Pre-filled on creation with already-known domains, marked « à vérifier ». Empty list: no filtering, and the run summary says so.

8. **"Journal" Sheet (v1.3.0)**:
   - Timestamped summary of every run (trigger, menu, purge), including skipped runs and failures; capped at 500 rows.
   - Dashboard header shows the last run and the last recorded report. A last run older than one hour means the trigger has stopped.

9. **DNS Record Checks (v1.8.0)**:
   - For every domain in the **Domaines** sheet: **DMARC** (present, unique, policy, reports sent to an address the tool collects, external reporting-domain authorization), **SPF** (unique, **DNS lookup count** including nested `include:`, 10-lookup limit, `-all` / `~all` / `?all` / `+all` ending), **DKIM** (keys published for common selectors or those listed in the `selecteurs_dkim` column, revoked keys).
   - Results in the **Contrôle DNS** sheet: one status per check (OK, Info, Attention, Problème), the finding and what to do. A DNS failure reads « Non vérifié », never « Problème ».
   - Refreshed daily by the hourly run, and on demand: *DMARC > Contrôler les enregistrements DNS*.

### Prerequisites

- A dedicated Google Workspace account (e.g. `dmarc-bot@your-domain.com`) receiving `rua` reports.
- A Google Spreadsheet bound to the Apps Script project.
- Optional: A Google Drive folder for raw XML storage and CSV purge archives.
- Optional: An HTTPS webhook URL (Google Chat, Slack, Discord).

### Quick Setup

1. Create a Google Spreadsheet while logged in with the technical account.
2. Open *Extensions > Apps Script*, delete default `Code.gs`, and copy the `.gs` files as well as `appsscript.json`.
3. In [DmarcConfig.gs](DmarcConfig.gs), update `COMPTE_TECHNIQUE`. Reception addresses go in the **Domaines** sheet, `adresse_rua` column, created by the first run.
4. Refresh the spreadsheet and use the **DMARC** custom menu, in this order (details in [DEMARRAGE.md](DEMARRAGE.md)):
   1. *DMARC > Configurer le dossier d'archivage Drive* (paste Drive folder ID).
   2. *DMARC > Traiter les rapports maintenant*: this first run creates the **Domaines** sheet and stops, as no address is set yet.
   3. Fill in the **Domaines** sheet: your reception addresses (`adresse_rua` column) and your domains (`domaine` column).
   4. *DMARC > Traiter les rapports maintenant* again: reports are now fetched.
   5. *DMARC > Créer / réinitialiser le tableau de bord*.
   6. *DMARC > Configurer les alertes proactives*.
   7. *DMARC > Activer le traitement horaire* (set up automated hourly trigger).

### Updating the code

1. In the Apps Script editor, replace the content of every `Dmarc*.gs` file and of `appsscript.json`; add any new file. A bound script always runs the code currently in the editor: there is nothing to deploy.
2. *DMARC > À propos* must show the expected version; otherwise a file was not replaced.
3. Read the matching [CHANGELOG](CHANGELOG.md) entry: when it says so, recreate the dashboard (*DMARC > Créer / réinitialiser le tableau de bord*).
4. Some versions migrate existing data on their first run (e.g. 1.6.0, which adds the `cle` column). Migration is automatic, runs once, and the run summary (Journal sheet) reports what it did.

### OAuth Scopes

| Scope | Purpose |
| --- | --- |
| `mail.google.com` | Search, label, and trash DMARC report threads in Gmail. No permanent deletion. |
| `drive` | Save raw XML reports and CSV purge backups to the designated Drive folder. |
| `spreadsheets.currentonly` | Access only the active container spreadsheet (least-privilege). |
| `script.send_mail` | Send proactive alert notifications on compliance drops or rejection spikes. |
| `script.external_request` | DoH queries (`dns.google`) and webhook notifications. |
| `script.container.ui` | Display custom dialogs and spreadsheet menus. |
| `script.scriptapp` | Install and manage the hourly execution trigger. |
| `userinfo.email` | Ensure executions strictly originate from the authorized technical account. |

### Demo data

`demo/` holds an entirely fictitious dataset (`.example` domains, documentation IP ranges) to showcase the tool without exposing real reports. See [demo/README.md](demo/README.md) (in French).

### Automated Testing

Run the headless Node.js test suite simulating Google Workspace services:

```bash
node banc/test.js
```

Validate Apps Script bundle syntax:

```bash
cat Dmarc*.gs > /tmp/projet.js && node --check /tmp/projet.js && rm /tmp/projet.js
```

---

## Licence / License

Elastic License 2.0 — see [LICENSE](LICENSE).

Développé par / Developed by : **Fabrice Faucheux** — [https://faucheux.bzh](https://faucheux.bzh)
