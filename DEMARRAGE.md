# Démarrage

Ce guide prend l'installation depuis zéro. Comptez un quart d'heure.

> Si SPF, DKIM et DMARC vous sont peu familiers, lisez d'abord
> [COMPRENDRE-DMARC.md](COMPRENDRE-DMARC.md) : ce guide-ci suppose que vous
> savez ce qu'est un enregistrement DMARC et une adresse `rua`.

## 1. Préparer le compte technique

Un compte Workspace dédié (par exemple `dmarc-bot@example.com`) doit
recevoir les rapports. Pour chaque domaine surveillé, l'enregistrement DMARC
pointe vers une adresse qui aboutit dans sa boîte :

```
_dmarc.example.net.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@example.net"
```

`dmarc@example.net` est un alias du compte technique, ou un groupe dont
il est membre.

> Si l'adresse `rua` est dans un **autre** domaine que celui surveillé, le
> domaine destinataire doit publier un enregistrement d'autorisation
> (`example.net._report._dmarc.example.com TXT "v=DMARC1"`), faute de
> quoi les émetteurs sérieux n'envoient rien.

## 2. Créer le classeur et le script

1. **Connecté avec le compte technique**, créez un Google Sheet.
2. *Extensions > Apps Script*.
3. Supprimez le fichier `Code.gs` proposé par défaut. **Si vous migrez depuis
   l'ancienne version, supprimez aussi l'ancien `Code.gs`** : il déclare les
   mêmes fonctions que les nouveaux fichiers, le projet refuserait de se charger
   et toutes les fonctions deviendraient « introuvables ».
4. Créez un fichier par `.gs` de la racine du dépôt (même nom, même
   contenu).
5. *Paramètres du projet* > cochez « Afficher le fichier manifeste
   appsscript.json », puis remplacez son contenu par celui du dépôt.

## 3. Régler la configuration

Dans `DmarcConfig.gs` :

| Clé | À mettre |
| --- | --- |
| `COMPTE_TECHNIQUE` | l'adresse du compte technique |

Le dossier d'archive Drive ne se règle plus dans le code (depuis la v1.1.0) :
il se choisit depuis le menu, au point 2 de la section suivante. Sans archive,
le XML brut disparaît avec le fil, 30 jours après sa mise à la corbeille.

## 4. Premier passage

1. Rechargez le classeur : le menu **DMARC** apparaît.
2. *DMARC > Configurer le dossier d'archivage Drive*. Google demande d'abord
   les autorisations (voir la section « Portées » du README pour ce que chacune
   permet). Collez ensuite l'identifiant du dossier (la fin de son URL, après
   `folders/`), ou laissez vide pour ne pas archiver. Le script vérifie que le
   compte technique y a accès avant de l'enregistrer. **Faites-le avant le
   premier traitement** : un fil traité sans archive part à la corbeille avec
   son XML.
3. *DMARC > Traiter les rapports maintenant*. Ce premier passage crée
   l'onglet **Domaines**, constate qu'il ne contient aucune adresse de
   réception, et s'arrête sans rien relever en disant quoi faire.
4. Remplissez l'onglet **Domaines** :
   - colonne `adresse_rua` : les adresses de réception des rapports, celles de
     vos enregistrements DNS `rua=mailto:…`. Plusieurs dans une même cellule
     se séparent par une virgule. Une adresse mal formée est ignorée, et le
     bilan le signale ;
   - colonne `domaine` : un domaine par ligne. Seuls leurs rapports (et ceux
     de leurs sous-domaines) seront enregistrés. Tant que la colonne est vide,
     rien n'est filtré, et le bilan le rappelle.

   Une ligne peut porter un domaine, une adresse, ou les deux.
5. *DMARC > Traiter les rapports maintenant*, de nouveau. Le bilan s'affiche :
   fils traités, fils en erreur, nouveaux rapports, état de l'archivage.
6. *DMARC > Créer / réinitialiser le tableau de bord*. Les onglets
   « Paramètres », « Journal » et « _CacheIP » (masqué) sont créés en même
   temps.
7. *DMARC > Configurer les alertes proactives* : le destinataire des alertes
   (le compte technique par défaut), et au besoin l'URL HTTPS d'un webhook
   Google Chat, Slack ou Discord.
8. Relisez l'onglet **Paramètres** : seuils d'alerte, volume minimal, durée de
   rétention. Chaque ligne explique son effet.
9. *DMARC > Activer le traitement horaire*.

> **Mise à jour depuis une version antérieure à la 1.7.0.** Au premier
> passage, l'onglet Enregistrements reçoit la colonne `dkim_diag` (diagnostic
> DKIM) ; le bilan dit combien de lignes ont été migrées. Recréez ensuite le
> tableau de bord pour obtenir la colonne « DKIM » du Top 15 et le tableau
> « Non conformes : signature DKIM ».

> **Mise à jour depuis une version antérieure à la 1.6.0.** Au premier
> passage, les onglets Rapports et Enregistrements reçoivent une colonne `cle`
> (émetteur|identifiant) ; le bilan dit combien de lignes ont été migrées.
> Recréez ensuite le tableau de bord, dont la jointure utilise cette clé.

> **Mise à jour depuis une version antérieure à la 1.4.0.** Les adresses de
> réception ne sont plus dans `DmarcConfig.gs` (`ADRESSES_DMARC`) : recopiez-les
> dans la colonne `adresse_rua` de l'onglet Domaines **avant** que le
> déclencheur horaire ne tourne, sinon chaque passage s'arrête sans rien
> relever — sans rien perdre non plus : les rapports attendent dans Gmail.
> L'onglet Domaines d'une v1.3.0 reçoit la colonne `adresse_rua` tout seul, à
> droite des colonnes existantes. Sa colonne `domaine` est préremplie, à la
> création, avec les domaines déjà présents dans les rapports, marqués « à
> vérifier » : supprimez ceux qui ne sont pas à vous.

> **Mise à jour depuis la v1.0.0.** L'identifiant qui figurait dans
> `DmarcConfig.gs` n'est pas repris : tant que le point 2 n'est pas fait,
> l'archivage est désactivé et le bilan l'affiche en toutes lettres.

## 5. Au quotidien

- **Un fil en erreur** porte le libellé `DMARC-Erreur` dans Gmail. Le journal
  d'exécution (*Apps Script > Exécutions*) dit quelle pièce jointe a échoué.
  Souvent : un rapport forensique (`ruf`) ou une notification, sans pièce
  jointe. Les rapports lisibles du fil sont déjà dans le classeur : seul le
  fil attend. Une fois le problème compris, retirez le libellé (le fil sera
  retraité au passage suivant, sans doublon) ou supprimez le fil vous-même.
- **Dossier d'archive introuvable** (supprimé, droits retirés) : le traitement
  s'arrête **sans rien mettre à la corbeille**, et Google envoie au compte
  technique un courriel d'échec du déclencheur. Corrigez l'identifiant par le
  menu, ou videz-le pour désactiver l'archivage.
- **Une alerte arrive** : le courriel donne le domaine, le taux et les
  principales IP en cause. Le tableau de bord (domaine choisi en C4) montre le
  détail, avec le nom d'hôte vérifié de chaque source en colonne G.
  « NON VÉRIFIÉ » signifie que le nom affiché par l'IP ne pointe pas vers elle :
  ne vous y fiez pas.
- **Le bilan signale « Alerte NON transmise »** : il dit quel canal a échoué et
  pourquoi. L'alerte sera retentée au passage suivant.
- **Purger** : *DMARC > Archiver et purger les données anciennes*. Le nombre
  exact de rapports et d'enregistrements est annoncé avant confirmation ; ils
  sont archivés en CSV dans le dossier Drive avant d'être retirés. Sans dossier
  d'archive configuré, la purge est refusée.
- **Mise à jour depuis une version antérieure à la 1.2.0** : recréez le tableau
  de bord pour obtenir la colonne des noms d'hôte et le diagnostic.
- **Le libellé `DMARC-Hors-liste`** marque un fil dont un rapport vise un
  domaine absent de l'onglet Domaines. Rien n'en a été enregistré. S'il s'agit
  de l'un de vos domaines, ajoutez-le à l'onglet puis retirez le libellé ; le
  fil sera retraité. Sinon, supprimez le fil vous-même.
- **L'onglet Journal** donne le bilan de chaque passage, le plus récent en bas.
  En tête du tableau de bord, « Dernier passage » doit dater de moins d'une
  heure ; au-delà, le déclencheur est arrêté (réactivez-le depuis le compte
  technique).
- **Une alerte de silence** (« aucun rapport reçu depuis N jours ») : vérifiez
  l'enregistrement DNS `_dmarc` du domaine et l'acheminement de l'adresse `rua`
  jusqu'au compte technique.
- **Vérifier la configuration DNS de vos domaines** : *DMARC > Contrôler les
  enregistrements DNS*, puis l'onglet « Contrôle DNS ». Le contrôle est aussi
  refait chaque jour. Pour DKIM, indiquez vos sélecteurs dans la colonne
  `selecteurs_dkim` de l'onglet Domaines (le sélecteur se lit dans l'en-tête
  `DKIM-Signature`, balise `s=`, d'un e-mail envoyé) ; sans eux, seuls les
  sélecteurs courants sont essayés.
- **Un doute sur un onglet, un libellé ou un chiffre** : *DMARC > Aide* ouvre
  l'onglet « Aide », qui explique chaque onglet et chaque libellé, ainsi que
  les bases de SPF, DKIM et DMARC.
- **Savoir quelle version tourne** : *DMARC > À propos*.
- **Partager le tableau de bord** : en lecture seule. Tout éditeur du classeur
  peut modifier le script, qui s'exécute avec les droits du compte technique.
  Depuis la 1.4.0, il peut aussi changer les adresses de réception dans
  l'onglet Domaines, sans toucher au code : c'est une raison de plus de
  réserver l'édition aux administrateurs. Chaque changement se voit dans le
  bilan du passage suivant (onglet Journal).
