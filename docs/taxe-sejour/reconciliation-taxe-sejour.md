# Réconciliation de la taxe de séjour perdue à la migration SuperHote V1 vers V2

Document généré le 07/08/2026 à partir de deux sources indépendantes.

## Ce qui s'est passé

Lors de la migration du compte SuperHote en V2, le 09/06/2026, la ligne de taxe de séjour a
disparu de 20 réservations, et son montant a également été retiré du total facturé au voyageur.

La cause est identifiée et ne souffre aucune exception. La taxe était enregistrée de deux
façons selon la réservation :

| En V1, la taxe était | Réservations | Devenues en V2 |
|---|---:|---|
| comprise dans le revenu de séjour (`payé = brut`) | 77 | **toutes conservées** |
| ajoutée par-dessus le revenu de séjour (`payé = brut + taxe`) | 20 | **toutes perdues** |

Le moteur de migration reconstruit le détail des prix à partir du revenu de séjour. Quand la
taxe y était comprise, il l'a extraite et réémise correctement. Quand elle était un supplément
ajouté à la fin, elle ne s'y trouvait pas : il ne l'a jamais vue, et ne l'a pas réémise.

Aucune réservation Airbnb ni Booking n'est concernée. Sur ces canaux la plateforme collecte et
reverse la taxe elle-même, sous un autre type de ligne (`guest_exclusive_tax_remitted_by_airbnb`).

Le mode de saisie fautif a disparu avec la migration : les 12 réservations directes créées
nativement en V2 depuis le 09/06 portent toutes leur taxe. Le sinistre est clos, il ne
concerne que l'ancien stock.

## Comment les montants ont été reconstruits

Deux méthodes indépendantes, qui concordent sur **20 lignes sur 20** :

1. **Par la règle.** La taxe vaut 2 € par adulte et par nuit, les enfants exclus. Vérifiée sur
   les réservations non sinistrées, elle redonne les 20 montants au centime près.
2. **Par la sauvegarde.** Le fichier `bnb-pilot-sauvegardes/supabase-avant-import-superhote-v2_2026-07-31_22h29.json`
   contient l'état validé avant import, avec la taxe d'origine réservation par réservation.

La concordance parfaite des deux est la meilleure garantie disponible : la règle est
vérifiable par un tiers, la sauvegarde est une pièce datée.

## Les 20 réservations

### Confirmées, 18 lignes, 1 368 €

| Identifiant | Bien | Canal | Arrivée | Nuits | Adultes | Paiement | Taxe due | Total V2 actuel | Total corrigé |
|---|---|---|---|---:|---:|---|---:|---:|---:|
| 24655760 | Ambassador | Direct | 17/11/2025 | 14 | 15 | Payée | **420 €** | 5 830,69 € | 6 250,69 € |
| 24655663 | Villa Métis | Direct | 14/11/2025 | 22 | 4 | Payée | **176 €** | 3 128 € | 3 304 € |
| 24655753 | Ambassador | Direct | 13/04/2026 | 8 | 10 | Payée | **160 €** | 4 020 € | 4 180 € |
| 24655666 | Lodge | Website | 29/12/2025 | 5 | 9 | Impayée | **90 €** | 1 390,50 € | 1 480,50 € |
| 24655738 | Ambassador | Direct | 14/05/2026 | 3 | 14 | Payée | **84 €** | 1 950 € | 2 034 € |
| 24655736 | Lodge | Direct | 21/11/2025 | 3 | 12 | Payée | **72 €** | 1 013,55 € | 1 085,55 € |
| 24655728 | Ambassador | Website | 13/01/2026 | 3 | 11 | Impayée | **66 €** | 1 999,50 € | 2 065,50 € |
| 24655662 | Ambassador | Website | 11/10/2025 | 4 | 8 | Partielle | **64 €** | 1 618,40 € | 1 682,40 € |
| 24655665 | Ambassador | Direct | 05/05/2026 | 2 | 16 | Impayée | **64 €** | 400 € | 464 € |
| 24655732 | Lodge | Website | 26/09/2025 | 2 | 6 | Impayée | **24 €** | 824 € | 848 € |
| 24655670 | Villa Métis | Direct | 22/08/2025 | 2 | 6 | Payée | **24 €** | 466 € | 490 € |
| 24655711 | Ambassador | Direct | 12/01/2026 | 1 | 12 | Payée | **24 €** | 390 € | 414 € |
| 24655771 | Villa Métis | Direct | 26/06/2026 | 2 | 6 | Payée | **24 €** | 0 € | 24 € |
| 24655739 | Ambassador | Direct | 22/01/2026 | 1 | 10 | Payée | **20 €** | 320 € | 340 € |
| 24655697 | Villa Métis | Direct | 22/05/2026 | 3 | 3 | Annulée | **18 €** | 735 € | 753 € |
| 24655689 | Villa Métis | Direct | 30/05/2025 | 2 | 4 | Payée | **16 €** | 250 € | 266 € |
| 24655692 | Ambassador | Direct | 22/03/2026 | 1 | 7 | Payée | **14 €** | 0 € | 14 € |
| 24655658 | Lodge | Website | 25/10/2025 | 2 | 2 | Impayée | **8 €** | 659,20 € | 667,20 € |
| | | | | | | **Total** | **1 368 €** | | |

### Annulées, 2 lignes, aucune taxe due

| Identifiant | Bien | Canal | Arrivée | Statut | Taxe calculée |
|---|---|---|---|---|---:|
| 24655749 | Ambassador | Direct | 03/10/2025 | Annulée par le voyageur | 56 € |
| 24655764 | Lodge | Website | 13/10/2025 | Annulée par le voyageur | 32 € |

Ces deux lignes sont écartées de la réclamation : une réservation annulée ne génère aucune taxe due.

## Trois totaux à ne pas confondre

| Montant | Somme | À quoi il sert |
|---|---:|---|
| Donnée perdue, réservations confirmées | **1 368 €** | ce qu'on réclame à SuperHote au titre de la perte |
| Taxe effectivement encaissée (séjours réglés) | **1 034 €** | ce qui est certainement dû à la collectivité |
| Encaissement partiel ou nul | 334 € | à vérifier dossier par dossier avant de reverser |

Détail du dernier bloc : 252 € sur des séjours impayés, 64 € sur un séjour
partiellement réglé, 18 € sur un séjour dont le paiement a été annulé.

Répartition de la donnée perdue par bien : Ambassador 916 €, Villa Métis 258 €,
Lodge 194 €.

## Conséquence dans bnb-pilot

La fonction `AL_VALID.repriseTaxe()` restaure déjà la taxe de ces 20 réservations depuis la
dernière version validée : les chiffres de taxe affichés par l'application sont justes.

Un point n'est en revanche pas couvert. Le champ `montant_paye` recopie `total_price` de l'API,
or ce total a été amputé de la taxe. Pour ces 20 réservations, l'application sous-évalue donc
de la taxe ce que le voyageur a réellement payé. Exemple, la réservation 24655736 : l'app
affiche 1 013,55 € payés là où le voyageur a réglé 1 085,55 €. La colonne « Total corrigé »
du tableau ci-dessus donne la valeur juste pour chacune.

## Fichiers

- `reconciliation-taxe-sejour.csv` : les 20 lignes, exploitables en tableur
- Ce document : la méthode et les totaux
