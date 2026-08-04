# Synchronisation automatique Superhote V2 → bnb-pilot

## Contexte

L'import des réservations dans bnb-pilot se fait aujourd'hui par export CSV manuel depuis SuperHote. Ce chemin vient de prouver sa fragilité : la migration du compte en V2, le 9 juin 2026, a changé la langue et les colonnes de l'export sans préavis, et l'import est resté cassé jusqu'au 31 juillet sans que rien ne le signale.

SuperHote expose une **API publique V2 authentifiée par token**, découverte et testée le 31/07/2026 sur le compte de production. Elle permet une synchronisation incrémentale. L'objectif est de ne plus dépendre du CSV pour le quotidien, sans perdre le contrôle humain sur ce qui entre en base.

**Ce plan a été soumis à deux passes de critique adversariale indépendante. Voir l'annexe.**

## Le point qui doit décider, avant tout le reste

**Ce projet ne se justifie pas par le temps gagné.** Mesuré honnêtement : l'export CSV coûte environ 4 minutes, à raison d'une fois par mois cela fait moins d'une heure par an, face à 2,25 à 3,75 jours de développement. Le retour sur investissement en temps est négatif et le restera.

Il se justifie par trois choses, et il faut choisir en connaissance :

1. **La fiabilité.** Un import manuel oublié ou cassé ne se signale pas. Une synchro qui échoue envoie une alerte.
2. **La détection des suppressions**, aujourd'hui impossible : une réservation effacée chez SuperHote reste indéfiniment dans bnb-pilot.
3. **La fraîcheur**, prérequis de toute fonctionnalité future de tarification ou d'occupation à date.

Si aucun de ces trois points n'est prioritaire, le chemin CSV corrigé ce soir suffit, et ce plan doit être classé.

## Réponse à la question posée : la couverture des champs

Le CSV compte **26 colonnes**, dont **17 exploitées** par bnb-pilot.

| Catégorie | Colonnes |
|---|---|
| Reprises directement (14) | `booking id` `booking date` `checkin` `checkout` `nights` `guest first name` `guest last name` `people` `night price` `cleaning fees` `city taxes` `commission` `total payments` `channel` |
| **Reconstruites** (2) | `rental` via une jointure sur `/rentals` · `status` via la table de correspondance des codes |
| **Absente de l'API, et utilisée** (1) | **`payment charges`** |
| Absentes mais non utilisées (6) | `guest phone number` `guest email` `city` `address` `post code` `service charge` |
| Non utilisées, présentes des deux côtés (3) | `rental id` `nbr adults` `nbr children` |

**16 colonnes sur 17 sont couvertes. Une seule manque.** L'API apporte en plus 6 champs que le CSV n'a pas : `updated_at`, `canceled_at`, `created_at`, `external_id`, `status_label`, `currency`. Les trois premiers rendent l'incrémental possible.

Jeu de données de référence : 204 réservations, arrivées du 30/04/2025 au 10/04/2027, extraites le 31/07/2026.

## Le seul manque, chiffré sans dilution

L'API n'expose pas les frais de processeur de paiement.

| Mesure | Valeur |
|---|---|
| Réservations concernées | 15, dont 11 confirmées |
| Montant | 324,59 € au total · 215,03 € sur les confirmées |
| Rapporté au CA confirmé (264 521 €) | 0,081 % |
| **Rapporté aux 11 lignes confirmées concernées (15 250 €)** | **1,41 %** |
| Erreur par ligne | 19,55 € en moyenne, 51,24 € au maximum |
| Concentration | **9 réservations Booking confirmées sur 9**, et 2 directes sur 89 |

Le biais est systématique et surévalue toujours le montant versé. Il touche la totalité du canal Booking, plus deux réservations directes payées en ligne.

**Trajectoire** : c'est le poids de Booking qui commande. Booking pèse 9 réservations confirmées sur 181, soit 5 %. Le taux de 1,41 % sur les lignes concernées ne bouge pas si Booking croît, mais le montant absolu, lui, croît proportionnellement.

## La taxe de séjour

Deux faits distincts qu'il ne faut pas confondre :

- **L'API et le CSV donnent la même taxe, au centime, sur les 200 réservations comparées.** Aucun n'est meilleur.
- **18 réservations ont perdu leur taxe dans la base SuperHote**, soit 1 368 €. Ni l'API ni le CSV ne peuvent la restituer.

Vérifié sur le cas nominal : les **39** réservations réservées depuis le 1er juin 2026, tous canaux confondus, portent toutes leur taxe, à l'exception des 4 demandes d'information à 0 €. Le calcul fonctionne pour les nouvelles réservations sur Direct, Website, Airbnb et Booking.

La cause reste une **hypothèse** : corrélation temporelle avec la migration, sans confirmation de SuperHote. Le ticket support est rédigé dans `~/dev/bnb-pilot-sauvegardes/ticket-superhote-taxe-sejour.md` et doit partir avant la bascule.

**Point de conception à ne pas rater** : la synchro écrira ces 18 lignes avec une taxe à zéro. `repriseTaxe()` s'applique dans `openGate()`, donc **après** l'écriture dans la table d'attente et **avant** l'écriture dans `data_snapshots`. Cet enchaînement doit être testé explicitement au Lot 1.

## Architecture

```
Cron quotidien (Supabase)
  → Edge Function « superhote-sync »
     1. curseur = max(updated_at réellement ingéré) − 48 h
     2. GET /reservations?updated_since=<curseur>&per_page=100, paginé
     3. GET /rentals (1 appel, libellés)
     4. mapping sur les codes de statut, upsert dans sh_pending
     5. 1×/semaine : liste complète des identifiants → marquage des suppressions
  → bnb-pilot affiche un badge « N changements en attente »
  → validation via AL_VALID.openGate() existant, à la cadence choisie
  → data_snapshots + data_validations
```

**Le curseur part du `max(updated_at)` réellement ingéré**, pas de l'heure du dernier passage. Une interruption longue, par exemple une mise en pause du projet Supabase, ne provoque alors aucune perte. La marge de 48 h absorbe l'écart de fuseau, qui varie de 2 h en été à 3 h en hiver entre Europe/Paris, réglage du compte SuperHote, et l'Indian/Reunion où se trouve l'activité. L'upsert rend l'opération idempotente.

**Le mapping se fait sur le code numérique**, jamais sur le libellé, qui peut être traduit sans préavis : `1 → Confirmée`, `0` et `5 → Annulée`, `7 → exclue`, tout autre code lève une erreur explicite et arrête la synchro. Aucune valeur par défaut silencieuse.

**Volume attendu, mesuré** : hors pic de migration, **1,7 modification par jour**, 13 sur les 7 derniers jours. Une revue hebdomadaire portera sur une douzaine de lignes, pas des dizaines.

## Fichiers concernés

| Fichier | Nature |
|---|---|
| `supabase/functions/superhote-sync/index.ts` | à créer, dans le projet Supabase de bnb-pilot |
| migrations SQL | à créer : `sh_pending`, `sh_sync_state`, politiques RLS, purge |
| `~/dev/bnb-pilot/index.html` | à modifier : badge, alimentation de `openGate` depuis `sh_pending` |

**À réutiliser, ne rien réinventer** : `AL_VALID.openGate()`, `diff()`, `keyer()` et `repriseTaxe()` sont en production dans `index.html` depuis les PR #5 et #6, et couvrent déjà la validation, le rapprochement par identifiant et la conservation de la taxe. Le projet `seasonwise-pricing` fournit un modèle d'Edge Function exploitable ; en revanche son `channel_connections` stocke un secret **par utilisateur**, ce qui ne correspond pas ici à un secret unique, et ne doit pas être recopié.

## Schéma et protection des données

```sql
sh_pending (
  id text primary key, payload jsonb not null, bien text,
  updated_at timestamptz not null, fetched_at timestamptz not null,
  statut text not null default 'en_attente',   -- en_attente | valide | rejete | supprime
  traite_le timestamptz, traite_par text )

sh_sync_state (
  source text primary key, last_run_at timestamptz, last_updated timestamptz,
  last_full_check_at timestamptz, last_status text, last_error text )
```

**Règle d'upsert à spécifier avant de coder** : une ligne déjà `valide` dont l'`updated_at` distant a changé repasse en `en_attente`. Une ligne `rejete` **ne repasse pas** en attente automatiquement, sinon un refus délibéré reviendrait à chaque passage. Le statut `supprime` alimente la modale au même titre qu'une suppression.

**Données personnelles.** `sh_pending` contiendra des noms de voyageurs et des dates de séjour, et le dépôt `alexandreselly-eng/ambassador-lodge`, qui héberge bnb-pilot, est **public**.

Vérifié le 31/07 : bnb-pilot dispose déjà d'une authentification Supabase et les tables existantes sont protégées par RLS. La clé anon ne retourne rien sur `data_snapshots`, `data_validations` ni `properties`, alors qu'une session authentifiée les lit. Il n'y a donc pas d'authentification à construire, seulement à appliquer le même modèle.

- RLS sur `sh_pending` et `sh_sync_state`, sur le modèle des tables existantes
- purge des lignes `valide`, `rejete` et `supprime` de plus de 30 jours
- token dans les secrets Supabase, jamais dans le dépôt
- l'Edge Function vérifie le JWT de l'appelant sur le bouton « synchroniser maintenant », pour qu'un tiers ne puisse pas déclencher la synchro et consommer le quota

## Lots, charge et point d'arrêt

| Lot | Contenu | Charge | Critère d'acceptation |
|---|---|---|---|
| **1** | Edge Function, pagination, mapping des 16 champs disponibles, `sh_pending`, RLS, curseur `max(updated_at) − 48 h`, gestion du 429 | 1 à 2 j | Rejeu sur les 204 connues **plus** un test sur réservation vivante créée hors saison sur un logement désactivé des canaux, puis modifiée et annulée. Plus : les 18 lignes à taxe perdue ressortent avec leur taxe après passage dans `openGate()`. |
| **2** | Recalibrage de `revenu_brut` et `montant_paye` | 2 h | **196/200**, les 4 écarts étant exactement `24655705` `24655657` `24655674` `24655712`, anomalies de source documentées. Vérifié par calcul le 31/07. |
| **3** | Badge, alimentation d'`openGate` depuis `sh_pending`, bouton « synchroniser maintenant » | 0,5 à 1 j | La modale affiche les mêmes compteurs qu'un import CSV équivalent |
| **4** | Cron, journalisation, alerte e-mail, rapprochement hebdomadaire des suppressions | 0,5 j | Test d'échec provoqué : révoquer le token, vérifier la réception effective de l'alerte |

**Charge totale : 2,25 à 3,75 jours.**

**Le seul point d'arrêt utile est après le Lot 3**, pas après le Lot 2 : sans le Lot 3, rien n'alimente la modale et le CSV reste indispensable. S'arrêter au Lot 3 laisse une synchro à déclencher à la main depuis un bouton, ce qui est déjà tout le gain fonctionnel ; le Lot 4 n'ajoute que l'automatisme et l'alerte.

## Repli

Le chemin d'import CSV reste **opérationnel de façon permanente**, pas seulement pendant une période de transition : il est de toute façon nécessaire au rapprochement trimestriel des frais de transaction. Il est rejoué et vérifié à chaque rapprochement.

Scénario non couvert, assumé : si SuperHote supprimait l'export CSV, le repli disparaîtrait en même temps que lui. La seule parade serait de conserver un export archivé par trimestre, ce que fait déjà le dossier `~/dev/bnb-pilot-sauvegardes/`.

## Ce qui n'est pas établi et doit être vérifié avant de coder

| Point | État |
|---|---|
| Limites de débit | 8 appels sans 429 ne prouvent rien. Demander la limite documentée à SuperHote ; implémenter le back-off par défaut. |
| Webhooks | Le 403 « Invalid ability provided » peut venir d'un scope à cocher **ou** d'un palier tarifaire. À vérifier avant d'envisager une phase 2. |
| Plan Supabase | Les projets gratuits sont mis en pause après inactivité prolongée, ce qui casserait le cron. Vérifier le plan réel du projet et le coût du passage payant. |
| Budget récurrent | Trois postes potentiellement payants : plan Supabase, palier SuperHote pour les webhooks, renouvellement de clé. Non chiffrés à ce jour. |
| Expiration de la clé | `bnb-pilot sync` expire le **27/06/2027**. Rappel calendaire à J-30 et alerte automatique sur 401. |

## Vérification de bout en bout

1. Déclencher la fonction à la main et vérifier que `sh_pending` se remplit avec le bon nombre de lignes.
2. Rejouer le mapping sur les 204 réservations connues et comparer aux valeurs de `data_snapshots` : les 14 champs directs doivent être identiques au centime.
3. Créer une réservation de test chez SuperHote, **hors saison, sur un logement désactivé des canaux**, la modifier, l'annuler, la supprimer, et vérifier qu'elle traverse correctement les quatre états.
4. Vérifier que les 18 réservations à taxe perdue ressortent de `openGate()` avec leur taxe reprise.
5. Révoquer temporairement le token et vérifier la réception de l'alerte.
6. Depuis un navigateur non authentifié, tenter de lire `sh_pending` avec la clé anon : la réponse doit être vide.

---

## Annexe — Critique adversariale

- **Verdict** : passe 1 **À CORRIGER** · 27 critiques (17 majeures). Passe 2 sur la V2 : **À CORRIGER** · 37 critiques. Protocole arrêté après deux passes.
- **Mode** : sous-agent indépendant, contexte limité à la demande d'origine et au document.

**Majeures intégrées, et ce qui a changé**

| ID | Critique | Changement |
|---|---|---|
| P1-C2 | Contradiction sur la taxe : « toutes les données sont présentes » vs « 1 368 € perdus » | Section dédiée séparant les deux faits |
| P1-C7 | L'objectif « supprimer le CSV » est contredit par le rapprochement trimestriel | Objectif reformulé, chemin CSV conservé de façon permanente |
| P1-C8 | Aucune détection des suppressions | Rapprochement hebdomadaire des identifiants, statut `supprime` |
| P1-C9 | Le décalage de fuseau peut provoquer une perte silencieuse | Marge de recouvrement de 48 h |
| P1-C10 | `sh_pending` sans statut : une ligne refusée est perdue | Champ `statut` et règle d'upsert spécifiée |
| P1-C11 | Données nominatives, dépôt public, RLS non mentionnée | Section protection, purge, JWT sur la fonction |
| P1-C13 | Le contrôle humain n'a pas empêché le bug des annulées | Argument retiré, justification ramenée à sa vraie portée |
| P1-C14 | Critère du Lot 1 tautologique | Remplacé par un test sur réservation vivante |
| P1-C17 | Aucun pointage colonne par colonne | Tableau des 26 colonnes |
| P1-C22 · P2-C25 | Coût humain et retour sur investissement absents | **Section placée en tête : le projet n'est pas rentable en temps** |
| P2-C1 · C2 | `rental_id` compté deux fois, `rental` et `status` présentés comme repris à l'identique | Catégorie « reconstruites », 6 champs en plus et non 7 |
| P2-C5 · C6 | Le 1,41 % mélange 11 et 15 lignes, et n'est pas « la totalité de Booking » | Périmètres explicités ligne par ligne |
| P2-C12 | L'upsert écraserait la taxe reprise | Enchaînement `openGate` précisé et ajouté au critère du Lot 1 |
| P2-C15 | La marge de 48 h ne protège pas d'une interruption plus longue | Curseur calculé sur `max(updated_at)` ingéré |
| P2-C18 · C19 | Comportement de l'upsert et propagation des suppressions non définis | Règle d'upsert écrite, statut `supprime` ajouté |
| P2-C21 | Le bouton de synchro exposerait la fonction | Vérification du JWT |
| P2-C22 | Le test sur réservation vivante bloquerait des dates réelles | Hors saison, logement désactivé des canaux |
| P2-C27 | Point d'arrêt après le Lot 2 illusoire | Déplacé après le Lot 3, avec justification |
| P2-C28 · C30 | Contradictions sur la durée du repli et le caractère optionnel du rapprochement | Tranchées : repli permanent, rapprochement non optionnel |
| P2-C31 | Aucun budget récurrent | Ligne ajoutée dans les points non établis |
| P2-C26 | Total de charge faux (2,5 à 4 j) | Corrigé en 2,25 à 3,75 j |

**Majeures rejetées, sur preuve**

| ID | Critique | Motif du rejet |
|---|---|---|
| P1-C3 | « Les réservations futures n'auront jamais de taxe, cas nominal non traité » | **Réfutée par mesure** : les 39 réservations réservées depuis le 01/06/2026, tous canaux, portent toutes leur taxe. Le calcul fonctionne, seules 18 lignes historiques sont touchées. |
| P2-C10 | « L'échantillon exclut Booking et Airbnb » | **Réfutée par mesure** : 24 réservations Airbnb et Booking récentes vérifiées, toutes avec taxe non nulle hors demandes d'information. |
| P2-C20 | « RLS authentifiée incompatible avec une page publique à clé anon, authentification à construire » | **Réfutée par test** : bnb-pilot a déjà une authentification Supabase. La clé anon retourne vide sur les trois tables existantes, une session authentifiée les lit. Rien à construire. |
| P2-C3 | « Le critère 196/200 du Lot 2 est arithmétiquement impossible » | **Réfutée par calcul** : les frais de transaction affectent `montant`, pas `revenu_brut` ni `montant_paye`. Le recalibrage donne exactement 196/200 sur ces deux champs, les 4 écarts étant les 4 anomalies de source connues. |
| P1-C13 (partie) | « Aucun lot ne prévoit la correction du bug des annulées » | Déjà corrigé et en production, PR #6 mergée le 31/07. |
| P2-C13 | « 1 368 / 18 = 76 € exactement, chiffre improbable » | Coïncidence arithmétique. Le détail ligne à ligne existe, de 8 € à 420 €, dans le ticket support. |

**Limites résiduelles assumées**

- Le retour sur investissement en temps reste négatif. Le projet se justifie par la fiabilité, pas par l'économie.
- Le budget récurrent n'est pas chiffré : plan Supabase, palier SuperHote, à vérifier avant d'engager.
- La cause de la perte des 18 taxes reste une hypothèse tant que SuperHote n'a pas répondu.
- Une panne silencieuse de l'API, un champ renommé ou une valeur passée à zéro, ne déclencherait aucune alerte. Seul l'échec d'authentification est surveillé.
- Les 4 réservations aux prix incohérents chez SuperHote restent non résolues et exclues des critères.
