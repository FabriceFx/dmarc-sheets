# Jeu de démonstration

Données **entièrement fictives** pour présenter l'outil (captures d'écran,
carrousel, formation) sans exposer les rapports d'une vraie organisation.

- Organisation inventée : `laiterie.example` (en `p=reject`) et
  `boutique-laiterie.example` (en `p=quarantine`).
- Tous les domaines sont en `.example`, réservé par la RFC 2606, qui ne peut
  appartenir à personne. Toutes les adresses IP sont dans les plages de
  documentation de la RFC 5737. Seuls les noms des émetteurs de rapports
  (google.com, Yahoo…) sont réels : ce sont des services publics.
- Les situations sont réellement observées : envois propres, prestataire bien
  configuré, prestataire qui signe avec son propre domaine, transferts,
  messages abîmés par la passerelle de filtrage d'un destinataire (« DKIM
  cassé »), usurpations (« DKIM absent »), et un émetteur de rapports muet sur
  DKIM (« DKIM non renseigné »).

Les chiffres que le tableau de bord affichera sont dans [RESUME.md](RESUME.md).

## Régénérer

```bash
node demo/generer-demo.js 2026-09-24
```

La date est celle de référence : les rapports couvrent les 30 jours qui la
précèdent. Même date, mêmes données. Choisissez la date du jour où vous faites
les captures, pour que le filtre « 30 jours » les couvre entièrement.

Le générateur réutilise les fonctions du projet (`diagnosticDkim_`,
`cleRapport_`) : le diagnostic des fichiers est celui que l'outil calculerait.
Le banc d'essai vérifie que les données restent fictives et reproductibles.

## Monter un classeur de démonstration

Dans un classeur **distinct** du classeur de production :

1. Créez un Google Sheets vide, puis *Extensions > Apps Script*. Copiez-y les
   fichiers `Dmarc*.gs` et `appsscript.json`.
2. Dans `DmarcConfig.gs` **de cette copie**, mettez votre propre adresse dans
   `COMPTE_TECHNIQUE` : seul ce compte peut créer le tableau de bord.
3. Créez quatre onglets aux noms exacts `Rapports`, `Enregistrements`,
   `Domaines` et `_CacheIP`. Dans chacun, *Fichier > Importer > Importer* le
   CSV du même nom, avec **« Remplacer la feuille actuelle »** et la conversion
   du texte en nombres et en dates activée.
4. Rechargez le classeur, puis *DMARC > Créer / réinitialiser le tableau de
   bord*. Mettez C5 sur 30 jours.

**N'activez pas le traitement horaire** dans ce classeur. Il chercherait des
rapports dans Gmail et essaierait de résoudre des adresses IP fictives, qui
effaceraient les noms d'hôte inventés.
