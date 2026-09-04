---
runtime: statique
decisions:
  - id: ADR-001
    titre: Application en fichier unique servi en statique
    statut: active
    remplace_par: null
  - id: ADR-002
    titre: Supabase pour la persistance, cle publiable en clair assumee
    statut: active
    remplace_par: null
  - id: ADR-003
    titre: Aucune ecriture automatique en base, tout passe par un sas de validation
    statut: active
    remplace_par: null
  - id: ADR-004
    titre: Deux garde-fous anti-effacement a seuils volontairement differents
    statut: active
    remplace_par: null
  - id: ADR-005
    titre: Synchro SuperHote par Edge Function Deno, surveillance hebergee hors de Supabase
    statut: active
    remplace_par: null
  - id: ADR-006
    titre: Detection anti-cache par constante APP_BUILD comparee au fichier servi
    statut: active
    remplace_par: null
---

# Architecture — bnb-pilot

> Reconstruit par rétro-ingénierie le 04/09/2026 depuis `CLAUDE.md`, `index.html`,
> `supabase/migrations/` et `.github/workflows/`.

## ADR-001 — Application en fichier unique servi en statique

`index.html`, 4 275 lignes, 524 Ko, HTML + CSS + JS en clair. Pas de build, pas de bundler, pas
de `node_modules`. Servi par GitHub Pages depuis `main`.

**Conséquence acceptée** : pas d'en-têtes de sécurité, donc pas de CSP par en-tête, et pas
d'application des droits côté serveur. Le périmètre par bien est filtré en JavaScript après
lecture, ce qui le rend contournable par un appel direct à l'API. C'est le point faible connu.

## ADR-002 — Supabase, clé publiable en clair

Projet `okehchypcrhpkcptnyxq`. La clé `sb_publishable_…` est dans `index.html`, sur un dépôt
public : c'est le fonctionnement prévu d'une clé publiable. La protection réelle doit donc venir
des politiques RLS, dont 3 seulement sont versionnées sur 15 tables utilisées.

## ADR-003 — Aucune écriture automatique en base

Tout ce qui entre dans `data_snapshots` passe par `AL_VALID.openGate()`. La synchro API remplit
un sas, elle ne décide pas. C'est le modèle de sécurité du projet.

## ADR-004 — Deux garde-fous à seuils différents

`SUPPRESSION_MASSIVE()` côté application arrête l'accident : 5 lignes ou 10 % du bien, avec
confirmation possible à l'écran. Le déclencheur `garde_fou_effacement` en base arrête la
catastrophe : plus de la moitié d'un bien, quel que soit le client, y compris un appel direct
avec une clé de service. **Aligner les deux seuils casserait toute suppression légitime.**

## ADR-005 — Surveillance hors du surveillé

L'alerte ntfy sur échec **et sur silence** est portée par deux workflows GitHub Actions,
délibérément hébergés hors de Supabase pour ne pas partager le point de panne du surveillé.

## ADR-006 — Anti-cache par `APP_BUILD`

L'application compare sa constante au fichier servi et se recharge si elles diffèrent. D'où la
règle : bumper `APP_BUILD` à chaque commit touchant `index.html`.
