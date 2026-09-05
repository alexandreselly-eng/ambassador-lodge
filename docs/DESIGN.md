---
parcours:
  - id: U001
    titre: Saisir une reservation a la main
    couvre: [F003]
  - id: U002
    titre: Lire le chiffre d affaires du mois
    couvre: [F004, F008]
  - id: U003
    titre: Situer l exercice contre son objectif
    couvre: [F006]
  - id: U004
    titre: Explorer les reservations ligne a ligne
    couvre: [F004]
  - id: U005
    titre: Consulter et corriger une reservation
    couvre: [F003]
  - id: U006
    titre: Voir l occupation d un bien dans le temps
    couvre: [F005]
  - id: U007
    titre: Decider d un tarif pour une periode
    couvre: [F007]
  - id: U008
    titre: Arbitrer ce qui entre en base
    couvre: [F001, F002]
  - id: U009
    titre: Comparer Superhote a la memoire validee
    couvre: [F002, F012]
  - id: U010
    titre: Recuperer une reservation supprimee
    couvre: [F011]
  - id: U011
    titre: Traiter les anomalies d import
    couvre: [F009]
  - id: U012
    titre: Donner un acces et verifier ce qu il montre
    couvre: [F010]
---

# Design — bnb-pilot

> **Document de rétro-ingénierie**, écrit le 05/09/2026. Il ne propose aucun écran nouveau :
> il recense les **douze onglets qui existent** dans `index.html` et les rattache aux exigences
> du PRD. Les libellés sont ceux du code, relevés depuis `origin/main`.
>
> Il satisfait le gate `design` de la doctrine, qui exige au moins un parcours dont chaque entrée
> couvre une exigence retenue. Il ne le contourne pas : ces parcours sont ceux que l'application
> fait réellement vivre aujourd'hui.

## Principe d'organisation

L'application est une page unique à douze onglets, sans navigation imbriquée. Un **filtre global**
en tête — bien, exercice, mois — s'applique à toutes les vues. C'est la seule notion transversale
d'interface : chaque onglet lit ce filtre et n'a pas son propre sélecteur de périmètre.

Deux familles s'y distinguent :

- les onglets **de lecture**, qui n'écrivent jamais : `Tableau de bord`, `Objectifs & point mort`,
  `Explorateur`, `Réservations`, `Calendrier`, `Tarification & vacance` ;
- les onglets **d'arbitrage et d'administration**, qui écrivent, tous derrière le sas :
  `Nouvelle saisie`, `Validation des données`, `Superhote & écarts`, `Corbeille`,
  `Qualité des données`, `Admin`.

## U001 — Saisir une réservation à la main · onglet « + Nouvelle saisie »

Couvre **F003**. Point d'entrée manuel, pour ce qui n'arrive ni par l'Excel ni par SuperHote.
Écrit par le même chemin que tout le reste, jamais directement.

## U002 — Lire le chiffre d'affaires du mois · onglet « Tableau de bord »

Couvre **F004** et **F008**. Chiffre d'affaires, acomptes, reste à encaisser, atterrissage, par
bien et par mois. Porte aussi le tableau mensuel de taxe de séjour, qui n'a pas d'onglet propre.

## U003 — Situer l'exercice contre son objectif · onglet « Objectifs & point mort »

Couvre **F006**. Objectif mensuel de chiffre d'affaires et de bénéfice, point mort, écart.

## U004 — Explorer les réservations ligne à ligne · onglet « Explorateur »

Couvre **F004**. Vue tabulaire libre sur les lignes validées, pour vérifier un montant contre
sa source sans passer par un écran de synthèse.

## U005 — Consulter et corriger une réservation · onglet « Réservations »

Couvre **F003**. La liste de référence, avec ses sous-totaux. C'est ici que se lit un écart
entre l'Excel et SuperHote sur une ligne donnée.

## U006 — Voir l'occupation d'un bien dans le temps · onglet « 📅 Calendrier »

Couvre **F005**. Calendrier par bien, nuits vendues et nuits libres.

## U007 — Décider d'un tarif pour une période · onglet « 💶 Tarification & vacance »

Couvre **F007**. Tarifs conseillés croisés avec les vacances scolaires des zones concernées.

## U008 — Arbitrer ce qui entre en base · onglet « ✓ Validation des données »

Couvre **F001** et **F002**. **Le parcours central du produit.** Rien n'entre dans
`data_snapshots` sans passer par la modale `AL_VALID.openGate()` : différentiel présenté,
arbitrage humain, puis écriture. La carte de synchro et la pastille d'état de la synchro API
vivent ici.

Deux confirmations distinctes s'y superposent : la validation elle-même, et une seconde
confirmation dès qu'une validation effacerait 5 lignes ou 10 % d'un bien.

## U009 — Comparer SuperHote à la mémoire validée · onglet « ⇄ Superhote & écarts »

Couvre **F002** et **F012**. Écarts ligne à ligne entre ce que publie SuperHote et ce qui a été
validé. C'est la vue qui rend visible un échec ou un silence de la synchro.

## U010 — Récupérer une réservation supprimée · onglet « Corbeille »

Couvre **F011**. Suppression réversible : une ligne retirée reste consultable et restaurable.

## U011 — Traiter les anomalies d'import · onglet « Qualité des données »

Couvre **F009**. Registre des lignes signalées à l'import, par catégorie et par sévérité.

## U012 — Donner un accès et vérifier ce qu'il montre · onglet « ⚙ Admin »

Couvre **F010**. Octroi et révocation d'accès par bien, et mode « voir en tant que » pour
constater ce qu'un compte donné voit réellement.

## Ce que ce document ne couvre pas

**F013**, la détection des suppressions côté SuperHote, **n'a aucun parcours** : la
fonctionnalité n'est pas réalisée, et rien à l'écran ne la représente aujourd'hui. Son parcours
sera écrit avec elle, pas avant.
