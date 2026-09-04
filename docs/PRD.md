---
exigences:
  - id: F001
    titre: Sas de validation avant toute ecriture en base
    statut: retenue
    lot: mvp
    origine: retro-ingenierie
  - id: F002
    titre: Synchronisation incrementale des reservations SuperHote
    statut: retenue
    lot: mvp
    origine: retro-ingenierie
  - id: F003
    titre: Rapprochement Excel contre SuperHote
    statut: retenue
    lot: mvp
    origine: retro-ingenierie
  - id: F004
    titre: Tableau de bord du chiffre d affaires
    statut: retenue
    lot: mvp
    origine: retro-ingenierie
  - id: F005
    titre: Calendrier des reservations par bien
    statut: retenue
    lot: mvp
    origine: retro-ingenierie
  - id: F006
    titre: Objectifs mensuels et point mort
    statut: retenue
    lot: v1
    origine: retro-ingenierie
  - id: F007
    titre: Tarification conseillee et vacance scolaire
    statut: retenue
    lot: v1
    origine: retro-ingenierie
  - id: F008
    titre: Taxe de sejour, calcul et tableau mensuel
    statut: retenue
    lot: v1
    origine: retro-ingenierie
  - id: F009
    titre: Registre des anomalies d import
    statut: retenue
    lot: v1
    origine: retro-ingenierie
  - id: F010
    titre: Octroi d acces par bien et mode voir en tant que
    statut: retenue
    lot: v1
    origine: retro-ingenierie
  - id: F011
    titre: Corbeille des reservations supprimees
    statut: retenue
    lot: v1
    origine: retro-ingenierie
  - id: F012
    titre: Alerte sur echec et sur silence de la synchro
    statut: retenue
    lot: mvp
    origine: retro-ingenierie
  - id: F013
    titre: Detection des suppressions cote SuperHote
    statut: retenue
    lot: plus-tard
    origine: retro-ingenierie
---

# PRD — bnb-pilot

> Reconstruit par rétro-ingénierie le 04/09/2026. Chaque exigence porte
> `origine: retro-ingenierie` : elle décrit **ce qui existe**, pas ce qui était voulu.
> Le classement en `lot` est le seul élément qui n'a pas été déduit du code.

## F001 — Sas de validation avant toute écriture en base

Aucune donnée n'entre dans la mémoire validée sans arbitrage humain. La synchro et les imports
remplissent un sas ; une modale présente les écarts, l'utilisateur tranche, et seule sa
validation écrit.

**Critères de réussite** : une validation qui effacerait 5 lignes ou 10 % d'un bien exige une
confirmation distincte · le jeu remplacé est archivé avant écrasement · si l'archivage échoue,
rien n'est écrasé.

## F002 — Synchronisation incrémentale des réservations SuperHote

Récupérer les réservations depuis l'API V2 par curseur incrémental, sans dépendre de l'export CSV.

**Critères** : le second passage ne relit que ce qui a changé · toute écriture Supabase vérifie
son erreur · un format de curseur invalide est détecté au second passage, pas au premier.

## F003 — Rapprochement Excel contre SuperHote

Comparer les saisies Excel de référence aux réservations SuperHote et présenter les écarts.

## F004 — Tableau de bord du chiffre d'affaires

Chiffre d'affaires, acomptes, reste à encaisser, atterrissage, par bien et par mois.

## F005 — Calendrier des réservations par bien
## F006 — Objectifs mensuels et point mort
## F007 — Tarification conseillée et vacance scolaire
## F008 — Taxe de séjour, calcul et tableau mensuel
## F009 — Registre des anomalies d'import
## F010 — Octroi d'accès par bien et mode « voir en tant que »
## F011 — Corbeille des réservations supprimées

## F012 — Alerte sur échec et sur silence de la synchro

Être prévenu quand la synchro échoue, **et** quand elle ne dit plus rien.

**Critères** : l'alerte est hébergée hors du système surveillé · elle se déclenche aussi sur le
silence, pas seulement sur l'erreur.

## F013 — Détection des suppressions côté SuperHote

**Non réalisée.** Le statut `supprime` est déclaré partout mais jamais écrit, `last_full_check_at`
n'est jamais renseigné, et `sh_pending_purge()` existe en base sans être appelée.
