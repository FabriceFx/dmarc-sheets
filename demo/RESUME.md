# Jeu de démonstration — chiffres attendus

> **Données entièrement fictives**, générées par `demo/generer-demo.js`
> (référence : 2026-09-24). Domaines en `.example`, adresses IP
> de documentation. À ne pas présenter comme des données réelles.

Tableau de bord avec C4 = « Tous » et C5 = 30 jours.

| Indicateur | Valeur |
| --- | --- |
| Rapports | 252 |
| Messages | 49 272 |
| Taux de conformité | 99,1 % |
| Taux DKIM | 99,1 % |
| Taux SPF | 93,6 % |
| Messages rejetés | 218 |
| Non conformes non rejetés | 216 |

## Non conformes : signature DKIM

| Signature | Non conformes | dont rejetés |
| --- | --- | --- |
| DKIM cassé | 250 | 159 |
| DKIM d'un tiers | 91 | 0 |
| DKIM absent | 49 | 33 |
| DKIM non renseigné | 44 | 26 |

Part des rejets qui sont des messages légitimes abîmés en route (DKIM cassé) :
**72,9 %**.

## Principales sources non conformes

| Domaine | IP | Enveloppe | Disposition | DKIM | Messages | Nom d'hôte |
| --- | --- | --- | --- | --- | --- | --- |
| boutique-laiterie.example | 198.51.100.60 | crm-saas.example | quarantine | DKIM d'un tiers | 91 | envoi.crm-saas.example (vérifié) |
| laiterie.example | 192.0.2.81 | laiterie.example | reject | DKIM cassé | 68 | filtre.passerelle-securite.example (vérifié) |
| laiterie.example | 192.0.2.80 | laiterie.example | reject | DKIM cassé | 48 | filtre.passerelle-securite.example (vérifié) |
| laiterie.example | 192.0.2.82 | laiterie.example | reject | DKIM cassé | 43 | filtre.passerelle-securite.example (vérifié) |
| boutique-laiterie.example | 192.0.2.82 | boutique-laiterie.example | quarantine | DKIM cassé | 40 | filtre.passerelle-securite.example (vérifié) |
| boutique-laiterie.example | 192.0.2.81 | boutique-laiterie.example | quarantine | DKIM cassé | 32 | filtre.passerelle-securite.example (vérifié) |
| laiterie.example | 192.0.2.120 | laiterie.example | reject | DKIM non renseigné | 26 | relais.distributeur.example (vérifié) |
| boutique-laiterie.example | 192.0.2.80 | boutique-laiterie.example | quarantine | DKIM cassé | 19 | filtre.passerelle-securite.example (vérifié) |
