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

**Une validation écrase intégralement les lignes du bien.** `commit()` fait
`upsert({ rows: sub })`, il ne fusionne pas : tout appelant qui transmet un jeu partiel efface
le reste. Deux filets depuis le 05/08/2026, à ne pas retirer. `SUPPRESSION_MASSIVE()` refuse
une validation qui effacerait 5 lignes ou 10 % du bien sans confirmation distincte, et le jeu
remplacé est archivé dans `data_snapshots_historique` avant écrasement. Si l'archivage échoue,
rien n'est écrasé.

**Deux garde-fous à deux niveaux, aux seuils volontairement différents.** `SUPPRESSION_MASSIVE()`
dans `index.html` arrête l'**accident** : 5 lignes ou 10 % du bien, avec confirmation possible à
l'écran. Le déclencheur `garde_fou_effacement` sur `data_snapshots` arrête la **catastrophe** :
plus de la moitié d'un bien, ou la suppression de la ligne entière, quel que soit le client, y
compris un appel direct à l'API avec une clé de service. Aligner les deux seuils ferait échouer
toute suppression légitime confirmée à l'écran sur une erreur SQL incompréhensible.

L'échappatoire est `set local app.effacement_autorise = 'oui'`, impossible à poser depuis
l'application : un effacement massif exige une session SQL, donc un geste conscient.

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

**Toute écriture Supabase vérifie son erreur.** `supabase-js` ne lève pas, il retourne
`{ error }` : un `await db.from(...).upsert(...)` sans destructuration échoue en silence.
C'est ce qui a figé le curseur de synchro pendant une journée entière le 04/08/2026, la
fonction se déclarant réussie à chaque passage. Un test parcourt l'Edge Function et refuse
toute écriture qui ignore son erreur.

**Incrémenter `VERSION_MAPPING` dès que `mapping.ts` change ce qu'il produit** (formule, champ
ajouté, règle modifiée). C'est ce qui fait repasser par la modale de validation les lignes déjà
arbitrées sous un calcul devenu périmé. Sans ça, une correction de formule reste invisible sur
tout l'historique déjà validé.

**Ne jamais faire `source ~/.superhote.env`.** Le token contient un `|` que le shell
interprète comme un tube, ce qui l'affiche en clair. Toujours `grep` puis `cut`, valeur
entre guillemets.

## Commandes utiles

```sh
npm test                      # mapping, règles d'upsert, reprise de taxe, garde-fous
open index.html               # l'app en local, mode hors ligne
```

## Accès et outils authentifiés

Claude pilote tout lui-même, sans faire taper de commandes. Deux fichiers y suffisent, en
`chmod 600`, hors dépôt, à lire avec `grep` puis `cut` et **jamais** avec `source` :

| Fichier | Contenu | Sert à |
|---|---|---|
| `~/.supabase-jeton.env` | jeton d'accès personnel Supabase | CLI Supabase : deploy, secrets, clés |
| `~/.supabase-bnb.env` | clé `sb_secret_` du projet | appeler l'Edge Function |
| `~/.superhote.env` | token API SuperHote | régénérer les fixtures |

Raccourcis dans `~/bin/`, un mot chacun :

| Commande | |
|---|---|
| `bnb-sync` | lance la synchro · `bnb-sync surveillance` teste l'alerte |
| `bnb-deploy` | déploie l'Edge Function |
| `bnb-cle` | récupère la clé secrète (`--reveal`, le CLI la masque par défaut) |
| `bnb-cles` | liste les clés sans leurs valeurs |
| `bnb-sql` | copie une migration dans le presse-papiers |

**La clé secrète se sélectionne par `type == 'secret'`, jamais par son nom** : la nouvelle
génération s'appelle `default`, et filtrer sur `service_role` retomberait sur la clé historique,
désactivée le 05/08/2026.

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
- **Lot 4 livré pour l'essentiel** (05/08/2026) : alerte ntfy sur échec **et sur silence**,
  déclenchée par deux workflows GitHub Actions, volontairement hors de Supabase pour ne pas
  partager le point de panne du surveillé. Surveillance 4×/jour, synchro quotidienne à 09h20
  heure Réunion. Le secret `DECLENCHEUR_SECRET` n'ouvre aucun accès à la base, ce qui permet
  de le confier à un dépôt public.
- **Lot 4, ce qui reste** : la détection des suppressions (statut `supprime` déclaré partout,
  jamais écrit ; `last_full_check_at` jamais renseigné) et le branchement de
  `sh_pending_purge()`, en base mais jamais appelée.

Jamais vérifié, à faire un jour : le **test sur réservation vivante** du Lot 1, créer une
réservation hors saison sur un logement désactivé des canaux, la modifier, l'annuler.

Hors code : le **ticket au support SuperHote** pour les 1 368 € de taxe de séjour perdus lors
de leur migration V1 vers V2 a été **envoyé le 05/08/2026**, réponse en attente. Le contenu
est dans `~/dev/bnb-pilot-sauvegardes/ticket-superhote-taxe-sejour.md`.

À leur réponse, deux issues et deux conduites :
- **ils restaurent la taxe** → la synchro la verra revenir et la modale proposera de remonter
  les 18 lignes. Rien à coder.
- **la donnée est perdue chez eux** → nos valeurs restent justes, `repriseTaxe()` les conserve
  depuis l'export V1 du 11/07. Le sujet devient déclaratif, plus informatique.
