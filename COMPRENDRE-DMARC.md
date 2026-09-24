# Comprendre SPF, DKIM et DMARC

Ce guide s'adresse à qui découvre l'authentification des e-mails. Il ne suppose
aucune connaissance préalable, et il se termine là où commence l'outil : la
lecture des rapports DMARC et du tableau de bord.

Pour installer l'outil, voir [DEMARRAGE.md](DEMARRAGE.md). Pour sa conception,
voir le [README](README.md).

> Les exemples utilisent des domaines et des adresses réservés à la
> documentation (`example.com`, `192.0.2.10`…). Remplacez-les par les vôtres.

---

## 1. Le problème : un e-mail ne prouve pas qui l'envoie

Le courrier électronique a été conçu à une époque de confiance. Rien, dans le
protocole d'origine, n'empêche quelqu'un d'envoyer un message avec
`From: direction@example.com` sans rien avoir à voir avec `example.com`.

C'est ce qu'exploitent l'hameçonnage et la fraude au président : le
destinataire voit votre nom de domaine et fait confiance au message.

Trois mécanismes, qui se complètent, permettent à un destinataire de vérifier
qu'un message vient bien de chez vous. Tous les trois se publient dans le DNS
de votre domaine, c'est-à-dire dans l'annuaire public d'Internet que tout
serveur de messagerie peut consulter.

| Mécanisme | Question à laquelle il répond | Où il se publie |
| --- | --- | --- |
| **SPF** | Ce serveur a-t-il le droit d'envoyer pour ce domaine ? | un enregistrement TXT sur le domaine |
| **DKIM** | Ce message a-t-il bien été signé par ce domaine, sans être modifié ? | une clé publique dans le DNS |
| **DMARC** | Le domaine vérifié est-il bien celui que le destinataire voit ? Et que faire si ce n'est pas le cas ? | un enregistrement TXT sur `_dmarc.domaine` |

---

## 2. Deux « expéditeurs » dans chaque message

Avant d'aller plus loin, il faut savoir qu'un e-mail porte **deux adresses
d'expéditeur**, et que c'est la source de la plupart des malentendus.

- **L'expéditeur d'enveloppe** (*envelope from*, *Return-Path*, *MAIL FROM*) :
  l'adresse utilisée entre serveurs, là où reviennent les messages d'erreur.
  Le destinataire ne la voit presque jamais.
- **L'expéditeur visible** (*header from*, l'en-tête `From:`) : l'adresse que le
  destinataire lit dans sa messagerie.

Elles peuvent être différentes, et c'est souvent le cas quand un prestataire
envoie pour vous. Une lettre d'information peut ainsi afficher
`From: actualites@example.com` et utiliser l'enveloppe
`bounce-4821@mail.prestataire.example`.

**SPF ne regarde que l'enveloppe. DMARC protège l'adresse visible.** Tout
l'enjeu de DMARC, comme on va le voir, est de relier les deux.

---

## 3. SPF : la liste des serveurs autorisés

Le domaine publie la liste des serveurs qui ont le droit d'envoyer pour lui :

```
example.com.  TXT  "v=spf1 include:_spf.google.com ip4:192.0.2.10 -all"
```

Ce qui se lit : sont autorisés les serveurs de Google Workspace
(`include:_spf.google.com`) et le serveur `192.0.2.10` ; tous les autres
(`-all`) ne le sont pas.

À la réception, le serveur destinataire regarde **l'adresse IP qui lui
parle** et le domaine de **l'enveloppe**, puis consulte le SPF de ce domaine.
Résultat : `pass`, `fail`, `softfail` (avec `~all`), `neutral`, ou une erreur.

Ce qu'il faut savoir :

- **Un seul enregistrement SPF par domaine.** Deux enregistrements `v=spf1`
  rendent le SPF invalide.
- **10 consultations DNS au plus.** Chaque `include:`, `a`, `mx`… en coûte une,
  et les `include:` des prestataires en contiennent souvent d'autres. Au-delà
  de dix, le résultat est une erreur (`permerror`), traitée comme un échec.
- **Le SPF casse au transfert.** Quand un destinataire transfère
  automatiquement votre message vers une autre boîte, c'est son serveur qui le
  réexpédie, et son adresse IP ne figure pas dans votre SPF.

---

## 4. DKIM : une signature que le transfert n'efface pas

Le serveur d'envoi **signe** chaque message avec une clé privée. La clé
publique correspondante est publiée dans le DNS, sous un nom qui contient un
*sélecteur* :

```
google._domainkey.example.com.  TXT  "v=DKIM1; k=rsa; p=MIIBIjANBgkq…"
```

Le message porte un en-tête `DKIM-Signature` qui indique notamment le domaine
signataire (`d=example.com`) et le sélecteur (`s=google`). Le destinataire
récupère la clé publique et vérifie que :

1. la signature a bien été produite par la clé privée de ce domaine ;
2. les parties signées du message n'ont pas été modifiées en route.

Ce qu'il faut savoir :

- **La signature suit le message** : elle survit en général au transfert
  automatique, ce qui compense la faiblesse de SPF.
- **Elle casse si le message est modifié.** Les listes de diffusion qui
  ajoutent un pied de page ou préfixent l'objet (`[liste]`) invalident souvent
  la signature.
- **Le domaine signataire compte.** Beaucoup de prestataires signent par défaut
  avec *leur* domaine (`d=prestataire.example`). La signature est alors valide,
  mais elle ne dit rien de *votre* domaine : il faut configurer chez eux une
  signature à votre nom.

---

## 5. DMARC : relier la vérification à l'adresse visible

SPF et DKIM vérifient *un* domaine, mais pas forcément celui que le
destinataire voit. Un fraudeur peut très bien passer SPF avec son propre domaine
d'enveloppe tout en affichant `From: direction@example.com`.

DMARC ajoute la règle qui manquait, **l'alignement** : le domaine vérifié par SPF
ou par DKIM doit correspondre au domaine de l'adresse visible.

### L'alignement, sur un exemple

Adresse visible : `From: factures@example.com`

| Cas | Enveloppe (SPF) | Signature (DKIM `d=`) | SPF aligné ? | DKIM aligné ? | DMARC |
| --- | --- | --- | --- | --- | --- |
| Votre serveur | `example.com`, pass | `example.com`, pass | oui | oui | **conforme** |
| Prestataire bien configuré | `mail.prestataire.example`, pass | `example.com`, pass | non | oui | **conforme** |
| Prestataire mal configuré | `mail.prestataire.example`, pass | `prestataire.example`, pass | non | non | **non conforme** |
| Transfert automatique | `example.com`, **fail** (IP du transféreur) | `example.com`, pass | — | oui | **conforme** |
| Usurpation | `fraudeur.example`, pass | aucune | non | non | **non conforme** |

La règle à retenir :

> **Un message est conforme DMARC si DKIM passe ET est aligné, OU si SPF passe
> ET est aligné.** Un seul des deux suffit.

C'est exactement la définition qu'utilise le tableau de bord pour son **taux de
conformité**.

### Alignement souple ou strict

- **Souple** (`adkim=r`, `aspf=r`, par défaut) : il suffit que les domaines
  aient le même domaine principal. `mail.example.com` s'aligne avec
  `example.com`.
- **Strict** (`adkim=s`, `aspf=s`) : les domaines doivent être identiques.

### L'enregistrement DMARC

```
_dmarc.example.com.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@example.com"
```

| Balise | Rôle |
| --- | --- |
| `p=` | La **politique** demandée aux destinataires pour un message non conforme : `none` (ne rien faire, seulement observer), `quarantine` (mettre en indésirables), `reject` (refuser). |
| `sp=` | La politique des sous-domaines, si elle diffère. |
| `rua=` | L'adresse où envoyer les **rapports agrégés**. C'est ce que relève cet outil. |
| `ruf=` | L'adresse des rapports forensiques (un message par échec). Peu d'émetteurs en envoient ; l'outil ne les traite pas. |
| `pct=` | Le pourcentage des messages auxquels appliquer la politique, pour une montée progressive. |
| `adkim=` / `aspf=` | L'alignement souple (`r`) ou strict (`s`). |

**Point essentiel : `p=none` ne protège rien, mais il permet de tout voir.** Les
destinataires continuent de livrer les messages, et ils vous envoient des
rapports. C'est toujours par là qu'on commence.

---

## 6. Les rapports agrégés : ce que l'outil lit pour vous

Chaque grand destinataire (Google, Microsoft, Yahoo et bien d'autres) envoie en
général **une fois par jour**, à l'adresse `rua`, un fichier XML compressé. Il
résume tous les messages qu'il a reçus en se réclamant de votre domaine, que ces
messages viennent de vous ou non.

Un rapport ne contient **aucun contenu de message**, seulement des comptages.
Voici un extrait commenté :

```xml
<record>
  <row>
    <source_ip>198.51.100.7</source_ip>   <!-- le serveur qui a envoyé -->
    <count>42</count>                     <!-- nombre de messages -->
    <policy_evaluated>                    <!-- le verdict DMARC, aligné -->
      <disposition>none</disposition>     <!-- ce que le destinataire a fait -->
      <dkim>fail</dkim>
      <spf>fail</spf>
    </policy_evaluated>
  </row>
  <identifiers>
    <header_from>example.com</header_from>      <!-- l'adresse visible -->
    <envelope_from>fraudeur.example</envelope_from>
  </identifiers>
  <auth_results>                          <!-- les résultats bruts, NON alignés -->
    <spf><domain>fraudeur.example</domain><result>pass</result></spf>
  </auth_results>
</record>
```

Lecture : 42 messages affichant `example.com` sont partis de `198.51.100.7`.
Le SPF est valide, mais pour `fraudeur.example`, donc non aligné. DMARC
échoue, et le destinataire les a tout de même livrés (`none`), puisque la
politique est `p=none`.

### Où retrouver ces champs dans le classeur

| Onglet « Enregistrements » | Dans le rapport | À savoir |
| --- | --- | --- |
| `source_ip` | `source_ip` | Le serveur émetteur. |
| `count` | `count` | Nombre de messages, pas nombre de lignes. |
| `disposition` | `policy_evaluated/disposition` | Ce que le destinataire a **appliqué**, pas forcément votre politique (il peut faire une exception, pour un transfert par exemple). |
| `dkim_eval`, `spf_eval` | `policy_evaluated` | Résultats **alignés** : ceux qui comptent pour DMARC. |
| `dkim_resultats`, `spf_resultats` | `auth_results` | Résultats **bruts, non alignés**. Un `pass` ici n'empêche pas un échec DMARC. |
| `header_from`, `envelope_from` | `identifiers` | Les deux expéditeurs du § 2. |

---

## 7. Lire le tableau de bord

| Élément | Question qu'il éclaire |
| --- | --- |
| **Taux de conformité** | Quelle part de mes messages passe DMARC ? C'est le chiffre à faire monter. |
| **Taux DKIM / Taux SPF** | Lequel des deux mécanismes porte la conformité ? Un taux DKIM bas signale des prestataires qui ne signent pas à votre nom. |
| **Messages rejetés** | Ce que les destinataires ont refusé, selon leur déclaration. |
| **Non conformes non rejetés** | Ce que votre politique actuelle laisse encore passer. En `p=none`, c'est tout ce qui n'est pas conforme. |
| **Top 15 des sources non conformes** | Qui envoie en votre nom sans être en règle. C'est **la liste de travail**. |
| **Nom d'hôte vérifié** | À qui appartient l'adresse IP, quand on peut le confirmer. « NON VÉRIFIÉ » signifie que le nom affiché ne pointe pas vers cette IP : ne vous y fiez pas. |
| **Émetteurs de rapports** | Qui vous renseigne (Google, Microsoft…). |
| **Diagnostic de politique** | Une indication, et non un verdict : jusqu'où le domaine choisi peut durcir sa politique. |

---

## 8. Que faire d'une source non conforme ?

Pour chaque ligne du Top 15, posez-vous ces questions dans l'ordre.

1. **Est-ce un service que vous utilisez ?** Lettre d'information, logiciel de
   facturation, CRM, outil de support, imprimante multifonction qui envoie des
   e-mails… Le nom d'hôte vérifié et l'`envelope_from` aident à le reconnaître.
   - **Oui** : il faut le mettre en règle. Activez chez ce prestataire la
     signature DKIM **à votre nom de domaine** : c'est la solution la plus
     solide, parce qu'elle survit au transfert. À défaut, ajoutez son
     `include:` à votre SPF, en surveillant la limite des 10 consultations.
2. **Est-ce un transfert ou une liste de diffusion ?** Le volume est souvent
   faible, les IP appartiennent à des hébergeurs de messagerie, et le DKIM brut
   est parfois `pass`. Ces échecs sont normaux, et vous n'y pouvez presque rien
   de votre côté. Ils expliquent qu'un taux de conformité atteigne rarement
   100 %.
3. **Inconnue, en volume, sans nom vérifié ?** Il s'agit probablement
   d'usurpation. C'est précisément ce que `p=reject` bloquera. Il n'y a rien à
   corriger, seulement à s'assurer qu'aucun service légitime ne se cache
   derrière.

---

## 9. DKIM cassé ou DKIM absent : ce que montrent les rapports réels

Avant de supprimer quoi que ce soit, une question se pose devant chaque message
rejeté : est-ce un fraudeur bloqué, ou l'un de vos propres messages qui n'est
jamais arrivé ? La signature DKIM permet presque toujours de trancher, et le
tableau de bord la classe pour vous (colonne « DKIM » du Top 15, tableau « Non
conformes : signature DKIM »).

| Diagnostic | Ce que dit le rapport | Lecture |
| --- | --- | --- |
| **DKIM cassé** | Une signature de votre domaine est présente, mais invalide. | Le message est parti de chez vous, puis a été modifié en route. Un fraudeur ne peut pas signer à votre nom. |
| **DKIM absent** | Aucune signature, alors que ce même rapport détaille DKIM pour d'autres messages. | Usurpation probable, ou serveur légitime à qui il manque DKIM. |
| **DKIM d'un tiers** | Seul un autre domaine a signé. | Prestataire à configurer, ou fraudeur qui signe avec son propre domaine. À examiner. |
| **DKIM non renseigné** | Le rapport ne détaille DKIM pour aucun message. | L'émetteur du rapport a omis ce détail (la RFC le permet). On ne peut pas trancher. |

### Un exemple chiffré

L'exemple ci-dessous vient du [jeu de démonstration](demo/README.md) : les
chiffres sont fictifs, mais les situations ont toutes été observées dans des
rapports réels, et dans des proportions comparables.

Le domaine, déjà en `p=reject`, est conforme à 99,1 %. En un mois, les rapports
comptent 218 messages rejetés. Le premier réflexe serait d'y voir 218
tentatives d'usurpation bloquées. Le tri par signature donne tout autre chose :

- **159 sont « DKIM cassé »**, donc des messages légitimes du domaine. Ce n'est
  pas l'expéditeur qui les a modifiés, mais le destinataire : sa passerelle de
  filtrage (ajout d'un bandeau « Externe », réécriture des liens) ou ses règles
  de transfert, avant que sa messagerie n'applique DMARC. Le serveur final voit
  alors l'adresse IP de la passerelle, absente du SPF, et une signature abîmée.
- **26 sont « non renseignés »** : un émetteur de rapports ne détaille DKIM
  pour aucun message. Rien ne permet de trancher, et l'outil le dit plutôt que
  d'annoncer une usurpation.
- **33 seulement sont « DKIM absent »**, venant d'adresses IP sans nom ou au
  nom usurpé : les vraies usurpations, que `p=reject` doit bloquer.

Trois leçons :

1. **Un rejet n'est pas toujours une attaque déjouée.** Ici, près des trois
   quarts des rejets sont des messages légitimes, perdus à cause d'un
   intermédiaire chez le destinataire. L'expéditeur ne peut pas corriger cela lui-même, mais il
   peut l'expliquer au destinataire. Chez Microsoft 365, le réglage en cause
   s'appelle *Enhanced Filtering for Connectors*.
2. **Regardez l'expéditeur d'enveloppe.** Un message qui affiche votre domaine
   mais dont l'enveloppe appartient à un autre domaine, SPF valide pour ce
   domaine-là, a été redirigé ou renvoyé par cet autre domaine. Ce n'est pas
   une usurpation au sens habituel.
3. **Un nom d'hôte ne désigne pas l'expéditeur.** `mail-sor-….google.com` est
   le nom ordinaire des serveurs d'envoi de Google, ceux de votre Google
   Workspace compris. Et la vérification d'un nom dans les deux sens peut
   donner des réponses différentes selon le serveur DNS interrogé :
   l'outil s'en tient à celui de Google.

---

## 10. La démarche type, de `p=none` à `p=reject`

1. **Publier `p=none`** avec une adresse `rua`, et laisser venir les rapports
   deux à quatre semaines. Les envois mensuels (factures, relances) doivent
   avoir eu le temps d'apparaître.
2. **Inventorier et corriger** les sources légitimes non conformes (§ 8),
   jusqu'à ce que le Top 15 ne contienne plus que des transferts et des
   inconnus.
3. **Passer à `p=quarantine`**, éventuellement progressivement avec `pct=`.
   Surveiller les rejets et les plaintes d'utilisateurs.
4. **Passer à `p=reject`.** Les usurpations sont désormais refusées par les
   destinataires qui appliquent DMARC.
5. **Continuer à lire les rapports.** Un nouveau prestataire mal configuré se
   verra dans le Top 15 avant que ses messages ne soient bloqués. Et
   l'**alerte de silence** vous préviendra si les rapports cessent d'arriver.

Le diagnostic du tableau de bord suit ces étapes, avec des seuils réglables dans
l'onglet « Paramètres ». Il reste **indicatif** : un taux élevé peut cacher un
service légitime à faible volume, que `p=reject` bloquerait. Relisez toujours le
Top 15 avant de durcir la politique.

---

## 11. Pièges fréquents

- **Plusieurs enregistrements SPF** sur un même domaine : le SPF est invalide.
- **Plus de 10 consultations DNS** dans le SPF : `permerror`, traité comme un échec.
- **`p=reject` trop tôt** : des factures ou des messages de support
  légitimes disparaissent sans que personne ne soit prévenu.
- **Oublier les sous-domaines** : sans `sp=`, ils héritent de `p=`. Un
  sous-domaine qui n'envoie jamais d'e-mail peut publier `p=reject` sans risque.
- **Confondre résultat brut et résultat aligné** : `spf_resultats = pass` ne
  veut pas dire conforme (§ 6).
- **Croire un rapport sur parole** : un rapport n'est pas authentifié, et
  n'importe qui peut en envoyer un à votre adresse `rua`. C'est pourquoi l'outil
  n'accepte que les domaines de l'onglet « Domaines ».
- **Adresse `rua` dans un autre domaine** : le domaine qui reçoit les rapports
  doit publier une autorisation, faute de quoi les émetteurs sérieux n'envoient
  rien (voir [DEMARRAGE.md](DEMARRAGE.md)).

---

## 12. Glossaire

| Terme | Définition |
| --- | --- |
| **Alignement** | Correspondance entre le domaine vérifié (SPF ou DKIM) et celui de l'adresse visible. |
| **Disposition** | Ce que le destinataire a fait du message : livré (`none`), mis en indésirables (`quarantine`), refusé (`reject`). |
| **Domaine principal** | Le domaine enregistré, sans ses sous-domaines : `example.com` pour `mail.example.com`. |
| **Envelope from** | Adresse d'expéditeur technique, vérifiée par SPF. |
| **Header from** | Adresse d'expéditeur visible, protégée par DMARC. |
| **PTR (DNS inverse)** | Nom d'hôte associé à une adresse IP. Il n'est fiable que s'il pointe lui-même vers cette IP. |
| **rua / ruf** | Adresses des rapports agrégés (quotidiens) et forensiques (par échec). |
| **Sélecteur DKIM** | Nom qui désigne une clé DKIM ; un domaine peut en avoir plusieurs. |

---

## 13. Pour aller plus loin

- **RFC 7489** : DMARC, le texte de référence.
- **RFC 7208** : SPF.
- **RFC 6376** : DKIM.
- [dmarc.org](https://dmarc.org) : ressources de l'initiative DMARC.

Fabrice Faucheux — https://faucheux.bzh
