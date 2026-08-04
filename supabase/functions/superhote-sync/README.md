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

## Lots 2 et 3, livrés

**Lot 2.** `revenu_brut` est recalibré sur `fare_accommodation + frais_menage`, que SuperHote
calcule lui-même. `montant_paye` vient de `total_price`. Les 9 seuls écarts avec la référence
sont des Booking où le CSV livrait 0 faute de colonne `night price` renseignée : l'API corrige
un défaut du CSV, elle n'en introduit pas.

**Lot 3.** Le module `AL_SYNC` d'`index.html` lit le sas et le présente à la modale existante.
Deux choix structurants :

- **La source enregistrée reste `superhote_csv`.** C'est la clé de stockage de la mémoire
  Superhote, pas un nom de format. Une clé distincte aurait créé un second jeu de snapshots
  et orphelinés les réservations déjà validées. Effet utile : `repriseTaxe()`, conditionné à
  cette source, s'applique sans modification. Le piège P2-C12 de la critique adversariale
  disparaît par construction.
- **`revenu_brut` et `montant_paye` entrent dans les champs comparés** par `diff()`. Sans
  cela, un import les remplaçait en silence, la modale n'affichant aucune modification alors
  que ces champs alimentent les conventions de montant et le tableau Superhote.

## Faire évoluer le mapping

`mapping.ts` porte une constante `VERSION_MAPPING`. **À incrémenter dès que le module change
ce qu'il produit**, formule, champ ajouté, règle modifiée.

Sans elle, une ligne déjà validée n'était re-proposée que si la donnée **distante** bougeait,
jamais si notre propre calcul évoluait. Constaté le 04/08/2026 : les 200 réservations validées
la veille sont restées figées sur un mapping périmé, et aucune synchronisation ne pouvait les
rattraper. La version stockée dans `sh_pending.mapping_version` fait repasser ces lignes en
attente au passage suivant, donc par la modale de validation.

Une ligne `rejete` n'est pas rouverte par un changement de version : un refus délibéré se lève
à la main.

## Alerte ntfy

Deux pannes de nature différente, et c'est la seconde qui compte :

- **l'échec** : la synchro tourne et rapporte une erreur. Elle s'annonce.
- **le silence** : la synchro ne tourne plus du tout. `last_status` reste figé sur son dernier
  `ok`, ce qui ressemble à un fonctionnement normal. C'est ce scénario qui a laissé l'import
  CSV cassé du 12 au 31/07/2026 sans le moindre signal.

L'échec alerte depuis la fonction elle-même. Le silence demande un appel extérieur :

```
POST /functions/v1/superhote-sync?surveillance
Authorization: Bearer <SURVEILLANCE_SECRET>
```

Ce mode ne synchronise rien. Il lit l'état, et notifie si la synchro est en échec ou muette
depuis plus de `SEUIL_SILENCE_H` heures (36 par défaut, pour tolérer un passage manqué).

**Il a son propre secret**, distinct de la clé de service : le déclencheur externe n'a besoin
que de lire un état et d'envoyer une notification. Lui confier la clé de service serait lui
donner tous les droits sur la base.

### Mise en place

1. Installe l'app **ntfy** ([ntfy.sh](https://ntfy.sh)), gratuite, sans compte.
2. Choisis un sujet **long et aléatoire**. Sur le serveur public, quiconque connaît le sujet
   lit les messages : c'est un secret de fait. Les messages ne portent aucune donnée
   nominative, et sont tronqués à 400 caractères pour limiter ce qu'une erreur inattendue
   laisserait fuir.
3. Abonne-toi à ce sujet dans l'app.
4. Enregistre les secrets :

```sh
supabase secrets set NTFY_TOPIC="bnb-pilot-<chaine-aleatoire>"
supabase secrets set SURVEILLANCE_SECRET="$(openssl rand -hex 24)"
# facultatif : serveur ntfy auto-hébergé, et seuil de silence
supabase secrets set NTFY_URL="https://ntfy.sh" SEUIL_SILENCE_H="36"
```

### Anti-répétition

Une alerte par tranche de 6 h. Une alerte qui se répète toutes les dix minutes finit en
sourdine, et c'est le meilleur moyen de rater la vraie. Tout passage réussi remet le compteur
à zéro, donc la panne suivante alerte immédiatement.

### Le déclencheur reste à brancher

Le mode surveillance ne s'appelle pas tout seul. Le brancher sur un cron Supabase serait un
demi-service : **un cron Supabase qui surveille une fonction Supabase ne détecte rien si tout
Supabase est en pause**, ce qui est précisément un des risques du plan pour un projet en offre
gratuite. Un déclencheur extérieur, GitHub Actions par exemple, n'a pas ce point de panne
commun.

### Vérification

Le seul critère qui vaut : **révoquer le token SuperHote, lancer une synchro, et vérifier que
la notification arrive sur le téléphone**. Une alerte qu'on n'a jamais vue arriver n'est pas
une alerte.

## Ce qui reste à faire

- **Lot 4, reste** : le déclencheur du mode surveillance, le cron de synchronisation, le
  rapprochement hebdomadaire des suppressions (statut `supprime`, déclaré mais jamais écrit),
  et le branchement de `sh_pending_purge()`, en base mais jamais appelée.
- **Ordre recommandé** : le déclencheur de surveillance AVANT le cron de synchronisation.
  L'inverse installerait dans une fausse sécurité, la panne étant d'autant plus silencieuse
  que plus personne ne clique.

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
