# CLAUDE.md - bnb-pilot

> Ce fichier ne contient QUE le spécifique de ce projet.
> Mes préférences globales (langue française, style direct, politique Git, conventions)
> sont héritées automatiquement de `~/.claude/CLAUDE.md`. Ne pas les recopier ici.

<!-- M3 (ia_agents)    : @/Users/ia_agents/dev/jarvis-starter-kit/context/GLOBAL-PREFS.md -->
<!-- Air (alexandre)   : @/Users/alexandre/Claude_Projets/jarvis-starter-kit/context/GLOBAL-PREFS.md -->

---

## Objectif du projet

Pilotage financier de la location saisonnière sur trois biens : Villa Ambassador, Lodge et
Villa Métis. L'app rapproche les réservations SuperHote de l'Excel de référence, suit le
chiffre d'affaires, les acomptes, le reste à encaisser, les objectifs et l'atterrissage.
La fidélité à l'Excel est le critère de vérité : un écart avec lui est un bug, pas une
divergence d'interprétation.

## Stack & outils

- **L'app est un fichier unique : `index.html`** (~500 Ko, HTML + CSS + JS en clair, Chart.js).
  Pas de build, pas de bundler, pas de `node_modules`. Servi par GitHub Pages depuis `main`.
- **Supabase** (projet `okehchypcrhpkcptnyxq`) pour la persistance : `data_snapshots`
  (mémoire validée par bien et par source), `data_validations` (registre), `properties`
  (référentiel des biens et mapping des libellés SuperHote), `sh_pending` et
  `sh_sync_state` (sas de la synchro API).
- **Edge Function Deno** `supabase/functions/superhote-sync` pour la synchro SuperHote V2.
- **Node** uniquement pour les tests (`node --test`, types TypeScript strippés nativement).

Dépôt : `alexandreselly-eng/ambassador-lodge`. **Il est PUBLIC.**

## Conventions du projet

**`APP_BUILD` doit être bumpé à chaque commit touchant `index.html`.** C'est le détecteur
anti-cache : l'app compare sa constante à celle du fichier servi et se recharge si elles
diffèrent. Oublier le bump laisse les navigateurs sur une version périmée.

**Messages de commit sans préfixe** `feat:` / `fix:`. Le dépôt utilise des phrases en
français : « Exclure les reservations annulees de tous les calculs ». S'y tenir.

**Aucune donnée nominative dans le dépôt.** Le dépôt est public et les réservations portent
des noms de voyageurs. Fixtures de test, exports CSV et sauvegardes de base vivent dans
`~/dev/bnb-pilot-sauvegardes/`, jamais ici. Toute nouvelle table portant des données
voyageurs doit avoir RLS actif et aucune politique `anon` : la clé publiable est en clair
dans `index.html`.

**Aucune écriture automatique en base.** Tout ce qui entre dans `data_snapshots` passe par
`AL_VALID.openGate()`, la modale de validation. La synchro API remplit un sas, elle ne
décide pas. C'est le modèle de sécurité du projet, il a déjà évité des dégâts.

**Ne rien réinventer côté validation.** `AL_VALID` expose `openGate`, `diff`, `keyer` et
`repriseTaxe`. `keyer` bascule sur l'identifiant SuperHote quand les deux versions
comparées le portent, sinon retombe sur bien + date + nom. `repriseTaxe` conserve une taxe
déjà validée plutôt que de la laisser écraser par un zéro.

**Une synchro incrémentale se valide sur deux passages consécutifs**, jamais un seul, et le
second doit montrer des chiffres différents du premier. Vaut pour tout chemin qui ne
s'exécute qu'à partir de la deuxième fois : curseur, pagination au-delà de la page 1,
reprise après échec, déduplication contre l'existant. Un format de curseur invalide a passé
28 tests unitaires et un premier passage réel avant d'être découvert au second, le 04/08/2026.

**Incrémenter `VERSION_MAPPING` dès que `mapping.ts` change ce qu'il produit** (formule, champ
ajouté, règle modifiée). C'est ce qui fait repasser par la modale de validation les lignes déjà
arbitrées sous un calcul devenu périmé. Sans ça, une correction de formule reste invisible sur
tout l'historique déjà validé.

**Ne jamais faire `source ~/.superhote.env`.** Le token contient un `|` que le shell
interprète comme un tube, ce qui l'affiche en clair. Toujours `grep` puis `cut`, valeur
entre guillemets.

## Commandes utiles

```sh
npm test                      # 29 tests : mapping, règles d'upsert, reprise de taxe
open index.html               # l'app en local, mode hors ligne
```

Synchro SuperHote, depuis une **session SSH** sur le M3 (le CLI Supabase est authentifié
là, et le préfixe `!` de Claude Code n'ouvre pas de TTY) :

```sh
supabase functions deploy superhote-sync
```

Détail du déploiement et régénération des fixtures :
`supabase/functions/superhote-sync/README.md`.

## État & prochaines étapes

Plan de référence : `docs/superpowers/plans/2026-07-31-synchro-api-superhote-v2.md`,
passé par deux tours de critique adversariale.

- **Lot 1 livré et en production** (04/08/2026) : Edge Function, `sh_pending`, mapping des
  16 champs disponibles, curseur incrémental. Premier passage 200 lignes, second passage
  4 lignes, filtre `updated_since` confirmé.
- **Lot 2 livré** : `revenu_brut` recalibré sur `fare_accommodation + frais_menage`,
  `montant_paye` sur `total_price`. Les 9 écarts restants sont des Booking où le CSV livrait 0.
- **Lot 3 livré** : module `AL_SYNC`, carte de synchro dans l'onglet Validation, pastille
  d'état avec signalement d'échec, sortie du sas après validation. La source enregistrée reste
  `superhote_csv`, ce qui fait disparaître le piège de `repriseTaxe()` par construction.
- **Lot 4** : cron et alerte. **Ne pas brancher le cron avant que le Lot 3 affiche l'état
  d'échec** : aujourd'hui `sh_sync_state.last_status` est écrit mais rien ne le lit, une
  panne serait donc silencieuse. C'est ce qui a laissé l'import CSV cassé du 12 au 31/07.

Hors code, en attente : le **ticket au support SuperHote** pour les 1 368 € de taxe de
séjour perdus lors de leur migration V1 vers V2. Brouillon dans
`~/dev/bnb-pilot-sauvegardes/ticket-superhote-taxe-sejour.md`.
