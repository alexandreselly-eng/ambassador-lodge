# superhote-sync — Lot 1

Synchronisation incrémentale des réservations depuis l'API publique SuperHote V2 vers la
table d'attente `sh_pending`. Plan complet :
[`docs/superpowers/plans/2026-07-31-synchro-api-superhote-v2.md`](../../../docs/superpowers/plans/2026-07-31-synchro-api-superhote-v2.md).

**Cette fonction n'écrit jamais dans `data_snapshots`.** Elle remplit un sas. La validation
humaine par `AL_VALID.openGate()` reste le seul chemin vers les données de production.

## Ce que fait le Lot 1

| Étape | Détail |
|---|---|
| Curseur | `max(updated_at)` réellement ingéré, moins 48 h. Une interruption longue ne perd rien. |
| Lecture | `GET /reservations?updated_since=…&per_page=100`, paginé, back-off exponentiel sur 429 et 5xx |
| Référentiels | `GET /rentals` et table `properties` : un appel chacun, pas un par réservation |
| Mapping | 16 champs. Statut mappé sur le **code numérique**, jamais sur le libellé. Un code inconnu arrête la synchro. |
| Écriture | Upsert dans `sh_pending`. Une ligne `rejete` ne se rouvre jamais toute seule. |

## Ce qui reste à faire

- **Lot 2** : recalibrer `revenu_brut`. La formule actuelle est celle héritée du CSV, exacte
  à 98/181 seulement. `montant_paye` a déjà été recalibré ici (`total_price`, 181/181).
- **Lot 3** : `index.html` ligne ~3920, `repriseTaxe()` n'est appelé que pour
  `source === 'superhote_csv'`. **À élargir à la source API**, sinon l'upsert de la synchro
  réécrira les 18 lignes à taxe restaurée avec un zéro. C'est le piège P2-C12 de la critique
  adversariale, couvert par le test `reprise de la taxe par AL_VALID`.
- **Lot 4** : cron, alerte e-mail, rapprochement hebdomadaire des suppressions,
  branchement de `sh_pending_purge()`.

## Tests

```sh
node --test 'tests/*.test.ts'
```

Les fixtures ne sont **pas** dans le dépôt : elles contiennent des noms de voyageurs et
`alexandreselly-eng/ambassador-lodge` est public. Elles vivent dans
`~/dev/bnb-pilot-sauvegardes/` :

| Fichier | Origine |
|---|---|
| `fixture-api-reservations_2026-08-04.json` | `GET /api/v2/public/reservations` (204 lignes) |
| `fixture-api-rentals_2026-08-04.json` | `GET /api/v2/public/rentals` |
| `import-a-valider.json` | l'import validé du 31/07/2026, référence des 200 lignes en base |

Pour les régénérer (le token est dans `~/.superhote.env`, jamais dans le dépôt) :

```sh
TOKEN=$(grep '^SUPERHOTE_TOKEN=' ~/.superhote.env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://connect.superhote.com/api/v2/public/reservations?per_page=100&page=1"
```

Ne jamais faire `source ~/.superhote.env` : le token contient un `|` que le shell
interpréterait comme un tube, ce qui l'affiche en clair. Toujours `grep` puis `cut`.

## Déploiement

Le CLI Supabase n'est pas installé sur cette machine et ces trois étapes demandent une
authentification interactive.

```sh
# 1. CLI
brew install supabase/tap/supabase
supabase login
supabase link --project-ref okehchypcrhpkcptnyxq

# 2. Migration (crée sh_pending, sh_sync_state, RLS, purge)
supabase db push

# 3. Secret puis déploiement
supabase secrets set SUPERHOTE_TOKEN="$(grep '^SUPERHOTE_TOKEN=' ~/.superhote.env | cut -d= -f2-)"
supabase functions deploy superhote-sync
```

Vérification, avec un JWT utilisateur ou la clé de service :

```sh
curl -s -X POST "https://okehchypcrhpkcptnyxq.supabase.co/functions/v1/superhote-sync" \
  -H "Authorization: Bearer <jeton>"
```

Réponse attendue au premier passage : `en_attente_ecrites: 200`,
`demandes_information_ignorees: 4`, `libelles_non_reconnus: 0`.

## Sécurité

- `verify_jwt = false` dans `config.toml` pour que le cron puisse appeler la fonction ; le
  contrôle est fait dans `verifierAppelant()`, qui accepte la clé de service **ou** un
  utilisateur authentifié. Sans cela, n'importe qui pourrait déclencher la synchro.
- `sh_pending` contient des noms de voyageurs. RLS actif, aucune politique pour `anon` :
  la clé publiable présente en clair dans `index.html` ne retourne rien.
- Le token SuperHote vit dans les secrets Supabase, jamais dans le dépôt. Clé
  `bnb-pilot sync`, lecture seule, **expire le 27/06/2027**.
