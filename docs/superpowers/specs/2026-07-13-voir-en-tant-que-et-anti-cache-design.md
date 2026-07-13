# Spec — « Voir en tant que » (aperçu admin) + Forçage anti-cache

Date : 2026-07-13
Outil : BnB pilot (`index.html`, appli mono-fichier, Supabase + RLS, hébergée sur GitHub Pages)
Statut : validé (design approuvé), prêt pour plan d'implémentation.

---

## 1. Contexte et motivation

Un utilisateur non-admin (Marc, `bibizfamilylodge@gmail.com`) voyait des chiffres délirants (nuitées et CA ~×2) sur son tableau de bord, alors que l'admin (Alexandre) voit des chiffres justes.

Diagnostic établi (résumé) :
- La base est saine. RLS correcte (`ds_select`/`resa_select` = `is_authorized() AND can_see_bien(...)`). Marc est bien limité à `["Ambassador","Lodge"]`.
- Vérité terrain 2026 : Ambassador 208 nuits + Lodge 80 = **288** ; +Villa Métis 128 = **416**. L'écran admin affiche 419 (≈ correct). L'écran de Marc affiche 580 (≈ 2× la vérité).
- Le code **actuel** calcule les nuitées indépendamment du statut admin ou du nombre de biens. Conclusion : **le navigateur de Marc exécute une version périmée en cache** (antérieure au correctif de prorata mensuel `f5a2390` du 29 juin). Le code en ligne est correct.

Deux besoins en découlent, validés avec l'utilisateur :
- **A. « Voir en tant que »** : permettre à l'admin de visualiser le périmètre d'un utilisateur (ses biens, ses onglets) sans lui demander de manipulation et sans ses identifiants.
- **B. Forçage anti-cache** : forcer automatiquement les navigateurs des utilisateurs à charger la dernière version, pour qu'un bug corrigé ne reste pas figé dans un cache.

Note d'honnêteté portée au design : l'aperçu (A) tourne avec le code à jour, donc il affichera les **bons** chiffres. Il sert à voir les périmètres et à confirmer que le code est sain, pas à reproduire l'écran bugué de Marc (qui n'existe que dans son cache). Le déblocage réel de Marc/Fabrice relève de B (ou d'un unique refresh manuel si leur build est trop ancien, voir §4.4).

---

## 2. Feature A — « Voir en tant que » (aperçu admin, lecture seule)

### 2.1 Principe

Aperçu **100 % côté client**. L'admin reste authentifié en tant que lui-même (aucune usurpation, aucun mot de passe tiers). L'appli **simule** le périmètre de l'utilisateur cible :
- `MY_BIENS` = `biens_autorises` de la cible,
- `IS_ADMIN` = `false` (pour l'UI),
puis re-rend l'interface. Un bandeau signale l'aperçu et un bouton permet d'en sortir sans rechargement.

### 2.2 Le point de conception central : filtrer les données par périmètre

Aujourd'hui, les données agrégées (`ROWS`, et les caches `SAISIES_ROWS`/`SH_RAW`) ne sont **jamais** filtrées côté client par les biens de l'utilisateur : c'est la RLS Supabase qui cloisonne à la lecture. Pour un vrai non-admin, `ROWS` ne contient donc que ses biens. Mais la **session admin a chargé tous les biens**. Simuler seulement l'habillage ne suffirait pas : l'aperçu montrerait quand même les données de tous les biens.

**Décision** : introduire un filtre de périmètre côté client, appliqué à toute agrégation, basé sur `visBiens()`.
- Prédicat unique : `bienVisible(logement)` ≡ `visBiens().includes(logement)`.
- Pour un vrai non-admin : `visBiens()` = ses biens et `ROWS` ne contient déjà que ceux-là → **no-op**.
- Pour l'admin en usage normal : `MY_BIENS = null` → `visBiens()` = tous les biens → **no-op**.
- Pour l'admin **en aperçu** : `visBiens()` = biens de la cible → restreint réellement les données.

C'est aussi un **filet de sécurité** (défense en profondeur) : même si la RLS venait à faillir, le client ne montrerait jamais un bien hors périmètre.

### 2.3 Points de code à modifier (agrégations)

Le filtre `bienVisible` doit être appliqué partout où un jeu de données est agrégé pour l'affichage :
- `applyDataSource()` (assignation de `ROWS`) : `ROWS = base.filter(d => bienVisible(d.logement))`. Couvre `currentRows()`, `genTaxeJustificatif()` et tout consommateur de `ROWS`.
- `renderRecon()` : ajouter `bienVisible(r.logement)` aux filtres `xl` (issu de `SAISIES_ROWS`) et `sh` (issu de `SH_RAW`), qui ne passent pas par `ROWS`.
- `currentRows()` : ajouter le prédicat en ceinture-bretelles (défense) même si `ROWS` est déjà filtré.

Règle générale à retenir pour l'implémentation : **toute agrégation destinée à l'affichage respecte `visBiens()`.**

### 2.4 État d'aperçu

Objet global :
```
PREVIEW = { active:false, email:null, biens:null, savedMyBiens:undefined, savedIsAdmin:undefined }
```
- **Entrée** : mémoriser `savedMyBiens = MY_BIENS`, `savedIsAdmin = IS_ADMIN` ; poser `MY_BIENS = biens de la cible`, `IS_ADMIN = false`, `PREVIEW.active = true` ; recalculer les onglets visibles ; re-rendre.
- **Sortie** : restaurer `MY_BIENS = savedMyBiens`, `IS_ADMIN = savedIsAdmin` ; `PREVIEW.active = false` ; recalculer onglets ; re-rendre. Aucun rechargement de page.

### 2.5 Interface

1. **Sélecteur** dans la zone **Admin** : « Voir en tant que… », liste déroulante peuplée depuis `authorized_emails` (email + biens autorisés). Bouton « Activer l'aperçu ».
2. **Bandeau permanent** en haut de l'appli pendant l'aperçu : `👁 Aperçu en tant que <email> — [Quitter l'aperçu]`. Style distinct (couleur d'accent) pour qu'on ne puisse pas l'oublier.
3. **Onglets** : pendant l'aperçu, masquer les onglets réservés admin/expert (Calendrier, Tarification & vacance, Validation des données, Admin, et tout autre onglet gaté par `IS_ADMIN` ou le mode expert), pour refléter exactement ce que voit l'utilisateur. Le mécanisme de gating existant doit être ré-exécuté après le changement de `IS_ADMIN`.
4. **Filtre de biens** : les boutons de périmètre (`fLog`) se limitent déjà à `visBiens()` → automatiquement corrects.

### 2.6 Lecture seule

Pendant l'aperçu, aucune écriture possible :
- Désactiver le bouton « + Nouvelle saisie » et les actions d'édition/suppression/restauration dans l'UI.
- **Garde-fou** au niveau des points d'écriture : les handlers qui appellent `Store.add/update/softDelete/restore` (et les upserts de config/objectifs/commissions) vérifient `if (PREVIEW.active) return;` en tête, avec un message discret « Lecture seule en mode aperçu ». La désactivation UI seule ne suffit pas : la garde logique est obligatoire.

### 2.7 Flux de données (résumé)

```
Admin authentifié → clic « Voir en tant que Marc »
  → PREVIEW.active=true ; MY_BIENS=[Ambassador,Lodge] ; IS_ADMIN=false
  → recompute onglets (masque admin) ; applyDataSource() re-filtre ROWS par visBiens()
  → render() : mêmes calculs, mais périmètre = biens de Marc
  → bandeau visible, écritures bloquées
clic « Quitter » → restaure MY_BIENS/IS_ADMIN → render() normal
```

---

## 3. Feature B — Forçage anti-cache

### 3.1 Existant

Un contrôle de version tourne déjà (IIFE autour de `APP_BUILD`) : il refait un `fetch` de la page avec cache-bust (`?cb=<ts>`, `cache:'no-store'`) toutes les 5 min, au retour d'onglet et au focus, compare le `APP_BUILD` distant au local. Aujourd'hui, en cas de nouvelle version, il affiche **une bannière que l'utilisateur peut fermer** → elle n'oblige à rien.

La **détection** fonctionne déjà. On ne change que la **réaction**.

### 3.2 Nouveau comportement

À la détection d'une nouvelle version :
- **Aucune saisie en cours** → **rechargement automatique** : `location.href = location.pathname + '?v=' + Date.now()`.
- **Saisie/édition en cours** → **bandeau non-ignorable** (pas de croix de fermeture) : « Nouvelle version disponible. Enregistrez votre saisie puis rechargez. [Recharger] ». L'utilisateur garde la main pour ne rien perdre.

### 3.3 Détection « saisie en cours » — `hasUnsavedInput()`

Renvoie vrai si l'un de ces cas est vrai :
- `state.editId != null` (une réservation est en cours d'édition), ou
- le formulaire « Nouvelle saisie » contient au moins un champ significatif non vide (au minimum : bien, entrée, sortie, nom, ou montant), ou
- une modale d'édition/validation est ouverte.

### 3.4 Garde anti-boucle

Pour éviter tout risque de rechargement en boucle si la détection se déclenchait à répétition : mémoriser en `sessionStorage` le build vers lequel on a déjà rechargé (`al_reloaded_build`). On ne déclenche un rechargement auto que si `APP_BUILD distant !== sessionStorage.al_reloaded_build`. On écrit cette valeur juste avant de recharger.

### 3.5 Caveat (limite structurelle, à communiquer)

Ce mécanisme ne peut agir que sur les navigateurs qui exécutent **déjà** une version **contenant** le contrôle de version. Un cache antérieur à l'introduction du contrôle ne pourra pas être réveillé à distance : il faudra **un unique** rechargement forcé (⌘⇧R) côté utilisateur, une seule fois. Ensuite, la mise à jour est automatique. C'est le cas probable de Marc aujourd'hui.

---

## 4. Hors périmètre (YAGNI)

- Pas de vraie usurpation d'identité / login réel avec le compte d'un tiers.
- Pas de journalisation des aperçus (ajoutable plus tard si besoin d'audit).
- Aucune modification de la RLS (elle est correcte).
- Pas de refonte du mécanisme de cache serveur (limites GitHub Pages) ; on reste sur le contrôle applicatif existant, renforcé.
- Pas de multi-sélection de biens dans l'aperçu (on prend le périmètre exact de l'utilisateur, tel quel).

---

## 5. Vérification (appli mono-fichier, sans framework de test)

Feature A :
1. Connecté en admin, activer l'aperçu pour Marc → seuls Ambassador+Lodge apparaissent dans les filtres ; onglets admin masqués ; bandeau visible.
2. Les nuitées affichées doivent correspondre à la somme réelle des 2 biens (≈ 288 pour 2026), pas 419 ni 580.
3. Comparer : la somme (Ambassador seul) + (Lodge seul) en aperçu = total « tous » en aperçu.
4. Tenter une saisie/édition → bloquée (bouton désactivé + garde logique).
5. « Quitter l'aperçu » → retour à la vue admin complète (3 biens, tous onglets), sans rechargement.

Feature B :
1. En local, simuler une nouvelle version (modifier `APP_BUILD` servi) → sans saisie en cours, la page se recharge seule une fois (et pas en boucle).
2. Avec une saisie en cours (champ rempli ou édition ouverte) → bandeau non-ignorable au lieu du rechargement ; clic « Recharger » recharge.
3. Vérifier la garde `sessionStorage` (pas de boucle).

---

## 6. Risques et mitigations

- **Le filtre de périmètre masque des biens en usage admin normal** → mitigé : no-op quand `MY_BIENS === null` (admin) ; couvert par le test A.5.
- **Une voie d'écriture non gardée pendant l'aperçu** → recenser tous les appels `Store.*` et upserts, ajouter la garde `PREVIEW.active`. Test A.4.
- **Boucle de rechargement** → garde `sessionStorage.al_reloaded_build` (§3.4).
- **Perte d'une saisie lors d'un rechargement auto** → `hasUnsavedInput()` bascule sur le bandeau non-ignorable (§3.3).
- **Onglets admin non re-masqués après bascule `IS_ADMIN`** → ré-exécuter explicitement le calcul de visibilité des onglets à l'entrée et à la sortie d'aperçu.

---

## 7. Points de code repérés (indicatif, lignes susceptibles de bouger)

- `MY_BIENS`, `visBiens()`, `allBiens()` : ~948-950.
- `loadProperties()` (source de `MY_BIENS`) : ~953-958.
- `applyDataSource()` (assignation `ROWS`) : ~1313.
- `currentRows()` : ~1563.
- `renderRecon()` (utilise `SAISIES_ROWS`/`SH_RAW`) : ~1279-1301.
- `render()` (sous-titre, KPIs) : ~1644.
- Contrôle de version / bannière (`APP_BUILD`) : ~988-1006.
- Points d'écriture : `Store.add/update/softDelete/restore` (~1120-1147), upserts config/objectifs/commissions.
- Zone Admin (emplacement du sélecteur) et gating des onglets par `IS_ADMIN`/expert : à localiser précisément au moment du plan.
