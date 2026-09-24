# Journal des modifications

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Ce projet suit le [Semantic Versioning](https://semver.org/lang/fr/).

## [1.7.2] - 2026-09-24

Préparation d'une présentation publique.

### Ajouté

- **Jeu de démonstration entièrement fictif** (`demo/`). Il décrit une
  organisation inventée (`laiterie.example`) et reproduit les situations
  observées dans des rapports réels : envois propres, prestataire bien ou mal
  configuré, transferts, messages abîmés par la passerelle d'un destinataire,
  usurpations, émetteur muet sur DKIM.
  - Le générateur est déterministe et réutilise les fonctions du projet, pour
    que le diagnostic écrit soit celui que l'outil calculerait.
  - Il produit les CSV à importer et `RESUME.md`, les chiffres que le tableau
    de bord affichera.
  - `demo/README.md` explique comment monter un classeur de démonstration.
- **Guide** : nouvelle section « DKIM cassé ou DKIM absent : ce que montrent
  les rapports réels ». Tableau des diagnostics, exemple chiffré tiré du jeu
  de démonstration, et trois leçons : un rejet n'est pas toujours une attaque
  déjouée, regarder l'expéditeur d'enveloppe, un nom d'hôte ne désigne pas
  l'expéditeur.
- **Journal** : chaque création réussie du tableau de bord y est inscrite,
  et plus seulement les échecs et les reprises. Deux échecs suivis d'une
  réussite silencieuse laissaient croire à un tableau jamais créé.

### Sécurité

- **Aucune donnée réelle dans le dépôt.** Les cas du banc d'essai rejoués
  depuis des rapports de production utilisent désormais des domaines en
  `.example` et des adresses IP de documentation. L'identifiant réel d'un
  dossier Drive est retiré de `origine/Code.gs`. Les exemples
  `votre-domaine.com` et `autre-domaine.com`, qui peuvent exister, deviennent
  `example.com` et `example.net`. `RAPPORT-REVUE.md`, document de travail
  contenant des volumes de production, est exclu du dépôt (`.gitignore`).

### Tests

- 109 cas, 3 de plus : la création réussie journalisée, et le jeu de
  démonstration, dont on vérifie qu'il est fictif (domaines en `.example`, IP
  de documentation), reproductible, et cohérent avec le diagnostic de l'outil.
  Y glisser un domaine réel ou une IP réelle fait échouer le banc.

## [1.7.1] - 2026-09-24

### Corrigé

- **« Échec du service Feuilles de calcul » à la création des onglets du
  tableau de bord.** L'étape a été identifiée grâce à la 1.6.1. L'erreur est
  survenue deux fois, à chaque fois juste après un traitement qui avait
  réécrit des milliers de lignes (migrations 1.6.0 et 1.7.0), c'est-à-dire
  pendant que Sheets recalculait `_Données`. La première avait disparu à la
  relance. Hypothèse retenue, non prouvée : une erreur passagère de document
  occupé.
  - Après la suppression des anciens onglets, le script laisse Sheets terminer
    (`flush`, puis 2 secondes de pause) avant de les recréer.
  - Une suppression ou une création qui échoue sur une erreur de service de
    Google est relancée jusqu'à deux fois, avec une pause croissante. Toute
    autre erreur n'est jamais relancée. Chaque opération vérifie d'abord ce
    qui existe déjà : un onglet créé malgré l'erreur signalée est repris, pas
    recréé en double.
  - Une création qui n'a réussi qu'après une reprise est notée au Journal ;
    un échec définitif indique le nombre de reprises.

### Tests

- 106 cas, 5 de plus, construits sur le message exact reçu dans le classeur
  réel : reconnaissance des erreurs de service (en français et en anglais),
  reprise réussie et journalisée, abandon après 3 essais, pas de reprise sur
  une erreur de programmation, onglet repris plutôt que recréé. Les 6 défauts
  correspondants, dont une boucle sans fin, ont été réintroduits un à un ; le
  banc les a tous détectés.

## [1.7.0] - 2026-09-24

### Ajouté

- **Diagnostic DKIM des messages non conformes.** Il distingue un message
  légitime abîmé en route d'une usurpation, ce qui demandait jusqu'ici un tri
  à la main. Chaque enregistrement reçoit une valeur, calculée par le script
  (nouvelle colonne `dkim_diag`, en fin de l'onglet Enregistrements) :
  - **DKIM valide** : une signature de votre domaine est valide.
  - **DKIM cassé** : une signature de votre domaine existe mais échoue. Le
    message a été modifié en route (transfert, passerelle de filtrage) ; un
    usurpateur ne peut pas signer à votre nom.
  - **DKIM d'un tiers** : seul un autre domaine a signé (prestataire à
    configurer, ou usurpateur qui signe avec son propre domaine).
  - **DKIM absent** : aucune signature, alors que l'émetteur du rapport
    détaille DKIM ailleurs dans ce rapport. Usurpation probable.
  - **DKIM non renseigné** : l'émetteur du rapport ne détaille DKIM pour
    aucun message du rapport (la RFC 7489 le permet). On ne peut pas trancher.
- **Au tableau de bord** : une colonne « DKIM » dans le Top 15, et un tableau
  « Non conformes : signature DKIM » (E64) qui compte les messages de chaque
  catégorie, chaque ligne portant sa lecture en note. Le nom d'hôte du Top 15
  passe en colonne H et les graphiques en colonne I.
- L'onglet Aide explique les catégories.

### Corrigé avant publication

- La première version du diagnostic classait « DKIM absent » tout message
  sans signature signalée. Sur des données réelles, une vingtaine de messages rejetés,
  relayés par Microsoft 365 et signalés par AMAZON-SES, seraient passés pour
  des usurpations : ce rapport ne détaillait DKIM pour aucun message. D'où la
  catégorie « DKIM non renseigné », décidée rapport par rapport.

### Modifié

- **Migration automatique** au premier passage : les enregistrements
  existants reçoivent leur diagnostic, calculé à partir de colonnes déjà
  présentes, donc sans cas ambigu. Les valeurs sont écrites avant l'en-tête,
  comme en 1.6.0. **Recréez ensuite le tableau de bord.**
- `diagnosticDkim_` rapproche les domaines par égalité ou par
  sous-domaine : deux sous-domaines frères (`a.example.com` et
  `b.example.com`) ne sont pas reconnus comme alignés, faute de liste des
  suffixes publics dans le script.

### Tests

- 101 cas, 5 de plus : les cas relevés dans les rapports réels, l'écriture à
  l'enregistrement, la migration (valeurs avant en-tête, une seule fois), le
  tableau de bord (formules et position du nom d'hôte) et le rapport muet sur
  DKIM. Les 8 défauts correspondants ont été réintroduits un à un ; le banc
  les a tous détectés.

## [1.6.1] - 2026-09-24

### Corrigé

- **« Impossible de générer le tableau de bord : Échec du service Feuilles de
  calcul » ne disait pas où la création échouait.** Ce message générique de
  Google ne nomme pas l'opération refusée, et le script le relayait tel quel.
  L'alerte nomme maintenant l'étape en cours, par exemple « calcul des
  formules sous en_US (flush) », « onglet Aide » ou « masquage de l'onglet
  _Données ». L'échec est aussi inscrit au Journal, et le message invite à
  relancer une fois, car cette erreur est parfois passagère.
- Si le rétablissement de la langue du classeur échoue à son tour, le
  message nomme les deux étapes au lieu de masquer la première.

La cause de l'échec signalé avec la 1.6.0 n'est **pas encore établie**. Cette
version sert à la trouver : la nouvelle formule de jointure de la 1.6.0 est
suspecte, sans preuve.

### Tests

- 96 cas, 2 de plus : un échec simulé pendant le calcul des formules, et un
  autre au masquage de `_Données`, doivent chacun nommer leur propre étape. Le
  premier vérifie aussi que l'échec est journalisé et que la langue est
  rétablie.

## [1.6.0] - 2026-09-24

### Corrigé

- **Deux émetteurs au même `report_id` se confondaient.** Le `report_id`
  n'est unique que chez un même émetteur (RFC 7489). Seul, il servait de clé
  à cinq endroits, et une collision avait plusieurs effets :
  - le rapport du second émetteur était pris pour un doublon et perdu ;
  - s'il était enregistré, le tableau de bord lui prêtait la date et le nom
    du premier ;
  - les alertes mêlaient les enregistrements des deux émetteurs ;
  - la purge de l'un emportait les enregistrements de l'autre.

  Point relevé à la revue initiale et laissé ouvert jusqu'ici.

### Modifié

- **Nouvelle colonne `cle`** (`émetteur|report_id`, émetteur sans distinction
  de casse), ajoutée en dernière position des onglets Rapports et
  Enregistrements. Les colonnes existantes, et donc les formules qui les
  lisent, ne bougent pas. Le dédoublonnage, la jointure du tableau de bord
  (`_Données!A2`), les alertes et la purge passent tous par cette clé.
- **Migration automatique au premier passage.** Les lignes existantes
  reçoivent leur clé, et le bilan indique combien. Les valeurs sont écrites
  avant l'en-tête, qui marque la migration comme faite : une interruption la
  fait recommencer, sans jamais la laisser à moitié. Un enregistrement dont le
  `report_id` ne désigne pas un seul rapport n'est pas rattaché au hasard : sa
  clé reste vide et il est compté dans le bilan.

  **Recréez le tableau de bord** après la mise à jour : sa jointure utilise
  désormais la clé.

### Documentation

- README (en français et en anglais) : dédoublonnage par émetteur et
  identifiant, filtre Période aligné sur la rétention (1.5.1), et migration
  automatique des données dans la marche à suivre pour mettre le code à jour.

### Tests

- 94 cas, 7 de plus : collision entre deux émetteurs, doublon relu depuis la
  feuille, casse de l'émetteur, migration (comptes, idempotence, valeurs avant
  en-tête), alertes, purge et jointure du tableau de bord par la clé. Chacun
  des 7 défauts correspondants a été réintroduit dans une copie ; le banc les
  a tous détectés.

## [1.5.1] - 2026-09-24

### Corrigé

- **Le filtre Période proposait jusqu'à 3 650 jours**, alors que la purge ne
  conserve par défaut que 180 jours et que le graphique d'évolution s'arrête à
  500. Ses choix viennent maintenant de `JOURS_RETENTION` : les durées
  usuelles (7, 30, 90, 180, 365 jours) inférieures à la rétention, puis la
  rétention elle-même, sans jamais dépasser 500. Avec la valeur par défaut, on
  obtient 7, 30, 90 et 180.
- **Le filtre suit la rétention sans recréer le tableau de bord.** Chaque
  passage horaire remet la liste à jour. Si la valeur choisie en C5 n'est plus
  proposée, par exemple après une baisse de la rétention, elle est ramenée au
  plus grand choix disponible, et le bilan le signale.
- La note de l'intitulé « Période » et l'explication de `JOURS_RETENTION` dans
  l'onglet Paramètres le disent. L'explication n'apparaît que dans les onglets
  Paramètres créés à partir de cette version : le script ne réécrit jamais une
  ligne existante.

### Tests

- 87 cas, 3 de plus : choix selon la rétention et le plafond du graphique,
  liste posée à la création, filtre ramené et bilan après une baisse de la
  rétention.

## [1.5.0] - 2026-09-24

### Ajouté

- **Onglet « Aide » dans le classeur** (menu *DMARC > Aide*). Il reprend
  l'essentiel du guide pour qui n'a que le classeur : les trois mécanismes et
  l'alignement, la lecture du tableau de bord, que faire d'une source non
  conforme et le parcours de `p=none` à `p=reject`. Il ajoute ce que le guide
  ne peut pas dire sur place : le rôle de chaque onglet du classeur, le sens
  des libellés Gmail `DMARC-Erreur` et `DMARC-Hors-liste`, et comment
  vérifier au quotidien que tout fonctionne.
  - Il ne contient que du texte et aucune formule : il s'affiche à l'identique
    en français comme en anglais.
  - Il porte la version qui l'a écrit. Chaque passage horaire le régénère si
    cette version diffère de celle du code, et seulement dans ce cas : l'aide
    ne décrit jamais un autre code que celui qui tourne.
  - Les noms d'onglets et de libellés viennent de la configuration : en
    renommer un dans le code met l'aide à jour.
  - Il est aussi créé avec le tableau de bord, et « À propos » y renvoie.

### Documentation

- **Guide pour débutants [COMPRENDRE-DMARC.md](COMPRENDRE-DMARC.md).** Il
  explique pourquoi un e-mail ne prouve pas qui l'envoie, les deux
  expéditeurs d'un message (enveloppe et adresse visible), et ce que font SPF,
  DKIM et DMARC. Il montre l'alignement sur un tableau d'exemples, commente un
  extrait de rapport agrégé et fait le lien avec les colonnes du classeur. Il
  guide la lecture du tableau de bord, donne la marche à suivre pour chaque
  source non conforme et le parcours de `p=none` à `p=reject`, puis liste les
  pièges fréquents et un glossaire. Le guide est relié depuis le README (en
  français et en anglais) et depuis DEMARRAGE.md.

### Tests

- 84 cas, 4 de plus : création par le menu sans aucune formule, présence de
  chaque onglet et de chaque libellé dans l'aide, régénération au changement
  de version (et seulement alors), création avec le tableau de bord.

## [1.4.4] - 2026-09-24

### Corrigé

- **`_Données!A2` restait en erreur dans un classeur en français, virgules
  comprises.** Constaté par Fabrice Faucheux. Les versions 1.4.1 et 1.4.2
  partaient d'une idée fausse : que Sheets lit toujours à l'anglaise une
  formule posée par `setFormula` et en traduit lui-même les séparateurs. La
  documentation de `setFormula` ne dit rien de la langue, et un classeur en
  français lit la formule à la française, où `,` est le séparateur décimal et
  `;` celui des arguments. Les correctifs de la 1.4.1 (`TEXT`) et de la 1.4.2
  (`HSTACK` au lieu de `{…}`) restent valables, mais ils ne suffisaient pas.

  Le tableau de bord passe désormais le classeur en `en_US` le temps de poser
  ses formules, puis rétablit sa langue d'origine, même en cas d'erreur.
  Revenu en français, Sheets retraduit lui-même les formules (`;`, `SI`,
  `RECHERCHEV`…), comme lorsqu'on change la langue à la main. Un classeur
  déjà en anglais n'est pas touché. Méthodes employées, vérifiées dans la
  documentation : `Spreadsheet.getSpreadsheetLocale()` et
  `setSpreadsheetLocale(locale)`.

  **Recréez le tableau de bord** pour que les formules soient reposées.

  **Validé dans un classeur réel en français** par Fabrice Faucheux : le
  banc d'essai ne pouvait pas prouver que Sheets retraduit les formules au
  retour en français, seul un vrai classeur le pouvait.

  Écarté : une réécriture du tableau de bord en valeurs calculées par le
  script, sans aucune formule. Elle aurait supprimé toute dépendance à la
  langue, mais aurait remplacé des filtres instantanés par un recalcul de
  quelques secondes à chaque changement. Elle n'a pas été retenue, puisque
  cette version fonctionne.

### Documentation

- README : prise en charge des classeurs en français et en anglais,
  onglet masqué `_Données`, et marche à suivre pour mettre le code à jour.

### Tests

- 80 cas, 3 de plus. Le faux classeur est maintenant en français par défaut
  et reproduit le comportement constaté : une virgule hors chaîne dans une
  formule posée y produit une erreur d'analyse, sauf sous `en_US`. Les cas
  vérifient qu'aucune formule n'est en erreur, que la langue est rétablie
  même si la construction échoue, et qu'un classeur en anglais n'est pas
  touché. Retirer le passage par `en_US` fait échouer le premier cas.

## [1.4.3] - 2026-09-24

Revue des numéros de version dans tout le projet.

### Corrigé

- **Le CHANGELOG contenait deux entrées `[1.2.0]`**, écrites en parallèle.
  Elles sont fusionnées en une seule, qui garde l'introduction et la section
  « Sécurité » de l'une, et les sections « Ajouté », « Corrigé avant
  publication » et « Tests » de l'autre. Quatre inexactitudes y sont
  corrigées : le DNS interrogé est `dns.google` seul, sans Cloudflare ; la
  fonction s'appelle `celluleCsv_` ; les opérateurs sont nommés comme dans le
  code ; la 1.2.0 comptait 49 cas.
- **Les titres du README recopiaient la version** (« Fonctionnalités
  principales (v1.4.0) »), déjà fausse en 1.4.2. Ils ne portent plus de
  numéro ; seul le badge le fait, et le banc le contrôle.

### Ajouté

- La version s'affiche là où l'on se demande quel code a tourné :
  - dans la colonne « origine » du **Journal** (`déclencheur horaire · v1.4.3`) ;
  - au pied des **courriels et webhooks d'alerte** ;
  - dans le **nom des CSV de purge**, et non dans leur contenu, où une ligne de
    plus casserait l'import.

### Tests

- 77 cas, 4 de plus :
  - le CHANGELOG commence par `VERSION`, sans doublon, dans l'ordre décroissant ;
  - chaque fichier `.gs` porte « Introduit en vX.Y.Z », avec une version
    présente au CHANGELOG, et ne recopie jamais la version courante ;
  - aucun titre du README ne porte de numéro de version ;
  - la version figure dans le courriel d'alerte et dans le nom des exports.

## [1.4.2] - 2026-09-24

### Corrigé

- **La jointure `_Données!A2` restait vide dans un classeur en français.**
  Diagnostic et correctif manuel de Fabrice Faucheux. Sheets traduit les
  séparateurs d'arguments d'une formule posée par le script, mais pas ceux d'un
  tableau littéral `{…}`. En français, le séparateur de colonnes y est `\` : la
  formule écrite `{Enregistrements!A2:M,…}` était invalide. Le script n'écrit
  plus aucun tableau littéral. La jointure utilise `HSTACK(…)` et la liste des
  domaines (`_Données!X1`) `VSTACK(…)`, deux fonctions dont les arguments
  ordinaires sont traduits comme les autres. La formule reste ainsi valable
  quelle que soit la langue du classeur ; une formule corrigée à la main en
  français aurait cassé les classeurs en anglais.

  **Recréez le tableau de bord** pour remplacer la formule corrigée à la main.

### Tests

- 73 cas. Un garde-fou refuse toute accolade hors chaîne dans les formules
  posées ; y remettre l'ancien tableau littéral le fait échouer.

## [1.4.1] - 2026-09-24

### Corrigé

- **Des formules du tableau de bord ne fonctionnaient pas dans un classeur
  en français.** Apps Script pose les formules à l'anglaise, et Sheets en
  traduit les fonctions et les séparateurs d'arguments (`IF` → `SI`,
  `,` → `;`), mais jamais le contenu des guillemets — ni, on l'a appris en
  1.4.2, les séparateurs d'un tableau littéral `{…}`. Les motifs de `TEXT(…; "dd/mm/yyyy hh:mm")`
  et `TEXT(…; "0.0%")` restaient donc tels quels, alors que leurs codes
  dépendent de la langue du classeur. Il n'y a plus aucun `TEXT` à motif :
  - les dates de la ligne 2 (dernier passage, dernier rapport) sont dans
    leurs propres cellules (C2 et E2), mises en forme par l'API, dont les
    motifs ne dépendent pas de la langue ;
  - les pourcentages du diagnostic sont construits par `ROUND(…*100; 1)&" %"`,
    qui prend le séparateur décimal du classeur (« 95,5 % » en français).

  **Recréez le tableau de bord** (*DMARC > Créer / réinitialiser le tableau
  de bord*) pour obtenir les nouvelles formules.
- Le tableau de bord indique que ses calculs sont dans l'onglet masqué
  `_Données`, et comment l'afficher.

### Tests

- 72 cas, 3 de plus. Pour la première fois, le banc exécute la création
  complète du tableau de bord puis sa réinitialisation. Le faux classeur
  apprend pour cela la notation A1, la taille de la grille, les onglets
  masqués, les graphiques et la mise en forme conditionnelle, et refuse ce
  que refuse le vrai (nom d'onglet en double, dimensions incohérentes). Un
  garde-fou refuse tout `TEXT(` dans les formules posées ; réintroduire l'ancien
  motif le fait échouer.

## [1.4.0] - 2026-09-23

### Modifié — action requise à la mise à jour

- **Les adresses de réception quittent le code.** `ADRESSES_DMARC` n'existe
  plus dans `DmarcConfig.gs`. Les adresses se renseignent dans la colonne
  `adresse_rua` de l'onglet « Domaines », une ou plusieurs par cellule
  (séparées par une virgule), et se modifient sans déploiement. **Recopiez-y
  vos adresses avant le prochain passage horaire.** Sinon, chaque passage
  s'arrête sans rien relever, et le bilan explique quoi faire. Rien n'est
  perdu : les rapports attendent dans Gmail.
- Un onglet Domaines créé par la 1.3.0 reçoit la colonne `adresse_rua`
  automatiquement, à droite des colonnes existantes. Les colonnes sont
  retrouvées par leur en-tête, et leur ordre est libre.

### Sécurité

- Les adresses entrent dans la requête Gmail. Une cellule comme
  `x@y.fr OR in:anywhere` élargirait la recherche à toute la boîte. Les
  adresses sont donc validées strictement (ni espace, ni accolade, ni
  parenthèse, ni guillemet) ; une adresse refusée est ignorée et signalée
  dans le bilan.
- Sans aucune adresse valide, le traitement ne lance aucune recherche, plutôt
  que de chercher sans filtre.
- Contrepartie assumée : tout éditeur du classeur peut désormais modifier ces
  adresses sans toucher au code. Chaque changement apparaît dans le bilan du
  passage suivant, inscrit au Journal.

### Tests

- 69 cas, 5 de plus : requête composée à partir de l'onglet, adresses piégées,
  absence d'adresse, migration d'un onglet 1.3.0, et badges du README
  (version et nombre de cas) comparés à `VERSION` et au banc. Les 4 défauts de
  cette version, ainsi que les 28 des versions 1.2.0 et 1.3.0, ont été
  réintroduits un à un dans une copie ; le banc les a tous détectés.

## [1.3.0] - 2026-09-23

Suite de la relecture complète de la 1.2.0. Les défauts relevés ne cassaient
rien, mais le script acceptait des données qu'il n'avait pas de raison de
croire, et il se taisait quand il aurait dû parler.

### Ajouté

- **Onglet « Domaines ».** Seuls les rapports des domaines listés (et de leurs
  sous-domaines) sont enregistrés. L'adresse `rua` est publique et un rapport
  n'est pas authentifié : sans cette liste, un rapport pour un domaine inventé
  entrait dans le tableau de bord et dans les alertes. Un rapport hors liste
  n'est ni archivé ni enregistré, et son fil est conservé sous le libellé
  `DMARC-Hors-liste` au lieu de partir à la corbeille. À la création, l'onglet
  est prérempli avec les domaines déjà connus, marqués « à vérifier ». Si la
  liste est vide, rien n'est filtré, et le bilan le dit.
- **Onglet « Journal ».** Il reçoit le bilan de chaque passage : déclencheur
  ou menu, verrou occupé, compte refusé, échec, et chaque purge. Il est limité
  à 500 lignes.
- **Alerte de silence.** Elle se déclenche quand un domaine de la liste n'a
  reçu aucun rapport depuis `JOURS_SANS_RAPPORT_ALERTE` jours (3 par défaut).
  Un enregistrement DNS supprimé ou une adresse cassée ne produisait aucune
  autre alerte.
- **Période couverte dans les alertes.** Un arriéré traité d'un coup est
  « reçu en 24 h », mais peut décrire un incident déjà ancien.

### Corrigé

- **« Dernier traitement » affichait la date du dernier rapport enregistré.**
  Un déclencheur arrêté ne se voyait pas. Le tableau de bord affiche désormais
  deux dates : le dernier passage, lu dans le Journal, et le dernier rapport.
  Sur une plage vide, il affiche « — » au lieu de « 30/12/1899 ».
- **Les seuils de couleur ne correspondaient pas au diagnostic.** La couleur
  des taux dépendait d'un seuil écrit dans le code (98 %) : à 98,5 %, le fond
  était vert pendant que le diagnostic affichait 🟡. Les couleurs suivent
  maintenant les seuils `SEUIL_PRET_QUARANTINE` et `SEUIL_PRET_REJECT` de
  l'onglet Paramètres, lus par `INDIRECT`.
- **Une valeur invalide dans Paramètres était utilisée par le tableau de
  bord.** Le code l'écartait, mais les formules la lisaient telle quelle :
  95 au lieu de 0,95 rendait tous les domaines 🔴. Chaque cellule de valeur
  porte maintenant une validation de données, dérivée des mêmes bornes que le
  contrôle du code.
- **Un dossier d'archive en lecture seule était accepté.** Tous les fils
  passaient ensuite en erreur. Le droit d'écriture est maintenant vérifié à la
  configuration. Comme `getAccess` ne voit pas les droits hérités d'un groupe,
  le script demande confirmation au lieu de refuser.
- **La corbeille s'appliquait au fil entier.** Un rapport arrivé dans le même
  fil pendant le traitement partait à la corbeille sans avoir été lu. Seuls les
  messages lus y vont désormais, et les messages déjà à la corbeille sont
  écartés à la lecture.
- **Un passage sauté parce que le verrou était pris ne laissait aucune trace.**
  Il est maintenant inscrit au Journal.

### Tests

- 64 cas (15 de plus). Nouveaux faux services : validation de données,
  `appendRow`, `deleteRows`, `Folder.getAccess` et `DriveApp.Permission`
  recopiés de la documentation. Les 14 défauts de cette version et les 14 de
  la 1.2.0 ont été réintroduits un à un dans une copie ; le banc les a tous
  détectés.

## [1.2.0] - 2026-09-23

*Angle croyance limitante :* Tu penses que passer à `p=reject` est un saut dans le vide qui risque de bloquer tes emails légitimes, ou que surveiller DMARC impose d'éplucher des milliers de lignes de rapports chaque semaine. C'est faux : avec la détection proactive d'anomalies, la résolution DNS inverse vérifiée de chaque source et le score d'éligibilité au rejet, ton classeur passe d'une archive passive à un pilote automatique de ta réputation email.

### Ajouté

- **Alertes.** Après chaque traitement, les rapports reçus dans les dernières
  24 heures sont examinés domaine par domaine. Une alerte part par courriel,
  et par webhook Google Chat, Slack ou Discord si l'un est configuré, dans
  deux cas : le taux de conformité passe sous un seuil, ou les rejets
  dépassent un volume. Une même alerte ne se répète pas plus d'une fois par
  24 h, et le bilan dit ce qui est parti et ce qui a échoué. Menu *Configurer
  les alertes proactives*.
- **Noms d'hôte des sources non conformes.** Colonne G du « Top 15 » : nom
  d'hôte de l'IP (DNS inverse, IPv4 et IPv6), cru seulement s'il renvoie
  lui-même vers cette IP. Sinon, il s'affiche « NON VÉRIFIÉ » et n'est
  rattaché à aucun opérateur. Les résultats sont gardés 30 jours dans l'onglet
  masqué `_CacheIP`.
- **Purge des données anciennes.** Menu *Archiver et purger les données
  anciennes*. Le menu annonce les nombres exacts avant de demander
  confirmation. Les données sont archivées en deux CSV dans Drive, puis
  retirées du classeur. Sans dossier d'archive, la purge est refusée.
- **Diagnostic de politique** (indicatif) sur le tableau de bord, pour le
  domaine choisi.
- **Onglet « Paramètres ».** Seuils d'alerte, volume minimal, durée de
  rétention et seuils du diagnostic se règlent sans déploiement. Le code
  n'ajoute que les clés absentes et ne réécrit jamais une valeur saisie. Une
  valeur invalide applique la valeur par défaut, et le bilan le signale.
- Portées `script.external_request` (DNS, webhook) et `script.send_mail`
  (courriel d'alerte).

### Corrigé avant publication

Défauts relevés à la revue de l'ébauche, chacun avec son cas au banc :

- Les alertes filtraient sur `date_debut`. Or un rapport couvre la veille :
  presque tout était écarté et l'alerte ne partait jamais. Le filtre porte
  maintenant sur `traite_le`, la date de réception.
- La portée `script.send_mail` manquait, donc le courriel échouait. Et le
  délai de 24 h était enregistré quand même : l'alerte disparaissait sans
  trace. Désormais, le délai n'est enregistré que si un canal a réussi.
- La purge ne prenait pas le verrou et effaçait avant de réécrire. Un passage
  horaire simultané pouvait perdre des rapports dont les fils étaient déjà à la
  corbeille.
- Un nom d'hôte inverse (PTR) usurpé était pris pour vrai, et les motifs non
  ancrés reconnaissaient `evil-outlook.com` comme Microsoft. Une panne DNS était
  mise en cache et affichée « PTR inexistant ».
- Les notes posées sur les IP devenaient fausses dès qu'un lecteur changeait
  de filtre. Elles sont remplacées par une colonne calculée.
- Le CSV d'archive pouvait contenir des formules exécutables.
- Le diagnostic rendait un verdict global sur « Tous ». Il ne se prononce plus
  que pour un domaine.
- Noms d'hôte et alertes tournaient au-delà du budget de temps. Ils sont
  reportés quand le budget est atteint.
- Le webhook Discord attend `content` et non `text`. Seules les adresses HTTPS
  sont acceptées.

### Modifié

- Les tableaux de bord existants n'ont pas la nouvelle colonne G ni le
  nouveau diagnostic : recréez-les par *Créer / réinitialiser le tableau de
  bord*.

### Sécurité

- **Moindre privilège et conformité des portées.** Ajout explicite des portées `script.send_mail` et `script.external_request` au manifeste `appsscript.json`.
- **Validation HTTPS stricte.** Les webhooks d'alerte imposent le protocole HTTPS et adaptent le corps envoyé à la plateforme cible : `content` pour Discord, `text` pour Google Chat et Slack.
- **Neutralisation CSV.** Tout caractère dangereux (`=`, `+`, `-`, `@`) en début de cellule est échappé par une apostrophe avant sérialisation CSV.

### Tests

- 49 cas (18 de plus). Les faux `MailApp` et `UrlFetchApp` refusent tout appel
  dont la portée manque au manifeste. Le faux DNS distingue réponse, absence
  et panne. Chaque défaut ci-dessus a été réintroduit dans une copie, et le
  banc l'a détecté.

## [1.1.1] - 2026-09-23

Version corrective de la 1.1.0.

### Corrigé

- **Les rapports lisibles d'un fil en échec étaient perdus.** Depuis la 1.1.0,
  un fil dont une seule pièce échouait ne livrait aucune ligne. Si la pièce
  restait illisible (rapport forensique, notification), chaque relance
  échouait de même : les bons rapports n'entraient jamais dans le classeur, et
  leur archive Drive se dupliquait à chaque passage. Ils sont désormais écrits
  avec le lot, et le fil garde son libellé d'erreur.
- **Dossier Drive inaccessible : les fils partaient à la corbeille sans
  archive.** La 1.1.0 consignait l'erreur et poursuivait ; le XML disparaissait
  30 jours plus tard. Un dossier configuré mais inaccessible arrête maintenant
  le traitement avant toute mise à la corbeille, avec un message qui dit quoi
  faire.
- **L'archivage se coupait sans prévenir à la mise à jour.** L'identifiant
  retiré de `DmarcConfig.gs` n'était repris nulle part. Le bilan de chaque
  traitement indique maintenant si l'archivage est actif, et dans quel dossier.
- **`DEMARRAGE.md`** citait encore `DRIVE_FOLDER_ID` dans `DmarcConfig.gs`, et
  faisait lancer le premier traitement avant de configurer l'archive.
- **Caractère BOM invisible** dans l'expression régulière de `parserRapport_`,
  remis sous la forme échappée `\uFEFF`.

### Tests

- Le faux `DriveApp` lève sur un identifiant inconnu, comme le vrai : il
  rendait un dossier pour n'importe quelle chaîne.
- Six cas ajoutés, un cas inversé (28 au total). Deux d'entre eux relisent la
  documentation et les sources : clés citées par `DEMARRAGE.md`, caractères
  invisibles.

## [1.1.0] - 2026-09-23

*Angle coût de l'inaction :* Laisser des identifiants Drive codés en dur et multiplier les synchronisations réseau synchrones (`flush`) à chaque fil ne coûte pas seulement des précieuses secondes d'exécution : chaque minute de quota GAS gaspillée et chaque arrêt silencieux sur un dossier manquant affaiblit directement la surveillance de la réputation de vos domaines email.

### Sécurité

- **Externalisation de l'archivage Drive.** L'identifiant du dossier d'archivage XML est retiré du code source et lu depuis `ScriptProperties` (`PropertiesService`).
- **Menu de paramétrage de l'archive.** Ajout d'une entrée « Configurer le dossier d'archivage Drive » pour renseigner ou désactiver le dossier sans toucher au code.
- **Protection du tableau de bord.** La fonction `creerTableauDeBord` vérifie désormais `verifierCompte_()` pour empêcher qu'un éditeur non autorisé n'écrase les onglets.
- **Outillage Git / Clasp.** Ajout d'un `.gitignore` excluant strictement `.clasp.json` et `.clasprc.json`, et d'un `.claspignore` pour n'envoyer que les fichiers Apps Script utiles.

### Performance

- **Écritures Sheets par lot (Batching).** Remplacement de l'écriture et du `SpreadsheetApp.flush()` systématiques fil par fil par une injection groupée de l'ensemble du lot, réduisant drastiquement les allers-retours réseau et le risque de timeout.

### Corrigé

- **Robustesse des dates.** Le parseur de date vérifie désormais `Number.isFinite(n) && n > 0` pour empêcher la création d'objets `Invalid Date` qui bloquent `setValues` dans Google Sheets.
- **Dossier Drive inaccessible.** Un ID invalide ou supprimé consigne désormais un avertissement au lieu d'interrompre le traitement des rapports.
- **Menu déroulant des domaines étendu.** La validation de données sur le filtre domaine pointe désormais sur une plage dynamique `X1:X` au lieu d'être figée à `X1:X200`.
- **Gestion des exceptions UI.** Chaque point d'entrée de menu est désormais protégé par un `try...catch` avec un message d'erreur clair et convivial.

### Tests

- Ajout de 4 cas de test dans le banc d'essai Node.js (23/23 cas réussis).

## [1.0.0] - 2026-09-23

Première version numérotée. Elle reprend le script d'origine (un seul `Code.gs`,
sans numéro) après revue.

### Corrigé

- **Injection de formules.** Le contenu d'un rapport, que n'importe qui peut
  envoyer à l'adresse `rua`, était écrit tel quel par `setValues` : un champ
  commençant par `=` devenait une formule exécutée à l'ouverture du classeur.
  Toute chaîne est désormais écrite comme texte.
- **Les report_id numériques étaient tronqués.** Sheets stockait
  `10326483716373626337` en `1,03E+19` : le doublon n'était plus reconnu, et
  deux rapports distincts partageaient la même clé de jointure dans le tableau
  de bord. Même correctif.
- **Archive Drive perdue en cas de panne.** Le rapport était marqué connu et
  écrit avant l'archivage ; si Drive échouait, la relance du fil le prenait pour
  un doublon et le XML n'était jamais archivé.
- **Retard qui ne se résorbait pas.** 50 fils par heure au plus : au-delà, la
  file grossissait indéfiniment. Le traitement enchaîne maintenant les pages
  tant que le budget de temps le permet, et dit quand il s'arrête.
- Une pièce jointe `.gz` sans nom faisait planter l'extraction.
- Une pièce `.docx` ou `.xlsx` était prise pour du XML (`openxmlformats`).
- Le tableau de bord n'était accessible par aucune entrée de menu, et
  `ajusterTableauDeBord_` n'était jamais appelé.
- Plus de 30 domaines faisaient déborder le tableau « Conformité par domaine »
  sur la section suivante ; l'erreur s'affichait « Aucune donnée ».

### Ajouté

- Menu *Créer / réinitialiser le tableau de bord* (avec confirmation) et
  *À propos* (version, explication des libellés et du taux de conformité).
- Notes explicatives sur chaque indicateur du tableau de bord.
- Banc d'essai hors Google (`node banc/test.js`).
- `appsscript.json` avec des portées déclarées explicitement.
- `README.md`, `DEMARRAGE.md`, `LICENSE`, `VERSION`.

### Modifié

- Découpage en six fichiers `Dmarc*.gs`. `CONFIG` et `TDB` deviennent
  `CONFIG_DMARC` et `TABLEAU_DMARC` pour éviter toute collision de nom global.
- Fonctions internes écrites en `const nom_ = () =>`, invisibles du menu
  d'exécution ; seuls les points d'entrée restent des `function`.
- `pct` est écrit comme nombre ; tous les autres champs texte, comme texte.
