# « Voir en tant que » + Forçage anti-cache — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un aperçu admin « Voir en tant que » (lecture seule) et forcer la mise à jour du cache navigateur des utilisateurs, dans l'appli mono-fichier BnB pilot.

**Architecture:** Tout se passe dans `index.html` (JS inline, sans build ni framework). L'aperçu est 100 % côté client : on simule `MY_BIENS`/`IS_ADMIN` de la cible, on filtre les données par périmètre (`visBiens()`), on masque les onglets non pertinents et on bloque les écritures, le tout réversible sans rechargement. Le forçage anti-cache renforce la *réaction* du contrôle de version déjà présent.

**Tech Stack:** HTML/CSS/JS vanilla, Supabase JS (RLS), Chart.js. Hébergement GitHub Pages.

## Global Constraints

- Fichier unique `index.html`, JS vanilla, **aucun build ni framework**, aucune dépendance ajoutée.
- Ne jamais renommer les clés `localStorage` préfixées `al_` ni les schémas de données stockés.
- Toute copie d'interface en **français**.
- Le filtre de périmètre doit être un **no-op** quand `MY_BIENS === null` (admin ou utilisateur « tous biens ») : aucune régression pour l'usage normal.
- Politique Git : commits autorisés ; **jamais** de `git push` sans validation explicite ; jamais de `--force` ni de `reset --hard`.
- Terminer chaque message de commit par : `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Pas de framework de test dans ce projet : la vérification de chaque tâche est **manuelle, dans le navigateur**, connecté en tant qu'admin (via le fichier ouvert localement ou le site). Utiliser la skill `run` / `verify` au moment de l'exécution pour piloter le navigateur.

## File Structure

- **Modifier uniquement** `index.html`. Aucun nouveau fichier de code.
- Regroupement logique des ajouts JS : les helpers de périmètre près de `visBiens()` ; l'état et les fonctions d'aperçu près de `enterApp()` ; le helper `hasUnsavedInput()` et la logique anti-cache près du contrôle de version existant (`APP_BUILD`).

---

## Task 1 : Filtre de périmètre des données (`bienVisible`)

Base de tout : faire respecter `visBiens()` à toutes les agrégations. No-op pour admin/non-admin réel, mais rend l'aperçu fidèle et ajoute une défense en profondeur.

**Files:**
- Modify: `index.html` (helper après `visBiens()` ~ligne 950 ; `applyDataSource()` ~1313 ; `currentRows()` ~1563 ; `renderRecon()` ~1281)

**Interfaces:**
- Produces: `bienVisible(logement:string) => boolean` — vrai si le bien est dans le périmètre courant (`MY_BIENS`), toujours vrai si `MY_BIENS === null`.

- [ ] **Step 1 : Ajouter le helper `bienVisible`**

Repérer (ligne ~950) :
```js
function visBiens(){ const all=allBiens(); return MY_BIENS? all.filter(b=>MY_BIENS.includes(b)) : all; }
```
Ajouter juste en dessous :
```js
function bienVisible(b){ return MY_BIENS ? MY_BIENS.includes(b) : true; }
```

- [ ] **Step 2 : Filtrer `ROWS` dans `applyDataSource()`**

Remplacer (ligne ~1313) :
```js
function applyDataSource(){ ROWS = (state.dataSource==='superhote')? SH_ROWS : SAISIES_ROWS; }
```
par :
```js
function applyDataSource(){ const base=(state.dataSource==='superhote')? SH_ROWS : SAISIES_ROWS; ROWS = MY_BIENS ? base.filter(d=>bienVisible(d.logement)) : base; }
```

- [ ] **Step 3 : Ceinture-bretelles dans `currentRows()`**

Remplacer la première condition du `forEach` (ligne ~1564). De :
```js
  ROWS.forEach(d=>{ if(!(state.log==='all'||d.logement===state.log))return; if(!(state.chan==='all'||d.origine===state.chan))return;
```
à :
```js
  ROWS.forEach(d=>{ if(!bienVisible(d.logement))return; if(!(state.log==='all'||d.logement===state.log))return; if(!(state.chan==='all'||d.origine===state.chan))return;
```

- [ ] **Step 4 : Filtrer le rapprochement `renderRecon()`**

Remplacer (ligne ~1281) :
```js
  const xl=SAISIES_ROWS.filter(scope); const sh=SH_RAW.filter(r=>r.annee===state.year && (state.log==='all'||r.logement===state.log));
```
par :
```js
  const xl=SAISIES_ROWS.filter(r=>bienVisible(r.logement)&&scope(r)); const sh=SH_RAW.filter(r=>bienVisible(r.logement)&&r.annee===state.year && (state.log==='all'||r.logement===state.log));
```

- [ ] **Step 5 : Vérifier (aucune régression admin)**

Ouvrir `index.html`, se connecter en admin. Attendu : le tableau de bord affiche exactement les mêmes chiffres qu'avant (filtre « Tous » = 3 biens, ex. 419 nuitées 2026). En console : `MY_BIENS` doit valoir `null` → `applyDataSource` ne filtre pas. Vérifier le rapprochement Excel↔Superhote inchangé.

- [ ] **Step 6 : Commit**

```bash
git add index.html
git commit -m "$(printf 'Perimetre: filtre des donnees par visBiens (defense en profondeur)\n\nToute agregation (ROWS, currentRows, renderRecon) respecte desormais\nMY_BIENS. No-op pour admin (MY_BIENS null) et non-admin reel (RLS).\nPrerequis a l apercu Voir en tant que.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2 : État `PREVIEW` + entrée/sortie + visibilité des onglets

**Files:**
- Modify: `index.html` (déclaration `PREVIEW` ~1091 ; nouvelle fonction `applyTabVisibility()` ; remplacement de la ligne ~1235 ; nouvelles fonctions `enterPreview`/`exitPreview`/`showPreviewBanner`/`hidePreviewBanner` après `enterApp()` ~1244)

**Interfaces:**
- Consumes: `bienVisible` (Task 1), `applyDataSource()`, `buildFilters()`, `render()`, `AL_EXPERT.apply()`.
- Produces:
  - `PREVIEW = {active:boolean, email:string|null, savedMyBiens, savedIsAdmin}`
  - `enterPreview(email:string, biens:string[]|null) => void`
  - `exitPreview() => void`
  - `applyTabVisibility() => void`

- [ ] **Step 1 : Déclarer l'état `PREVIEW`**

Repérer (ligne ~1091) :
```js
let IS_ADMIN=false, NEEDS_PASSWORD=false;
```
Ajouter juste en dessous :
```js
let PREVIEW={active:false,email:null,savedMyBiens:undefined,savedIsAdmin:undefined};
```

- [ ] **Step 2 : Ajouter `applyTabVisibility()`**

Ajouter cette fonction juste avant `function enterApp(user){` (ligne ~1227) :
```js
function applyTabVisibility(){
  const at=document.querySelector('.tabs button[data-t="admin"]'); if(at) at.style.display=IS_ADMIN?'inline-block':'none';
  const st=document.querySelector('.tabs button[data-t="saisie"]');
  if(PREVIEW.active){
    document.querySelectorAll('.tabs button.exp-tab').forEach(t=>t.style.display='none');
    const be=document.getElementById('btnExpert'); if(be) be.style.display='none';
    if(st) st.style.display='none';
  } else {
    if(st) st.style.display='';
    if(typeof AL_EXPERT!=='undefined') AL_EXPERT.apply();
  }
}
```

- [ ] **Step 3 : Router `enterApp` par `applyTabVisibility`**

Remplacer (ligne ~1235) :
```js
  const at=document.querySelector('.tabs button[data-t="admin"]'); if(at) at.style.display=IS_ADMIN?'inline-block':'none';
```
par :
```js
  applyTabVisibility();
```

- [ ] **Step 4 : Ajouter `enterPreview` / `exitPreview` + bandeau**

Ajouter, juste après la fin de `enterApp` (après la ligne `}` ~1244) :
```js
function enterPreview(email,biens){
  if(!IS_ADMIN && !PREVIEW.active) return;
  if(PREVIEW.active){ MY_BIENS=PREVIEW.savedMyBiens; IS_ADMIN=PREVIEW.savedIsAdmin; }
  PREVIEW.savedMyBiens=MY_BIENS; PREVIEW.savedIsAdmin=IS_ADMIN;
  PREVIEW.active=true; PREVIEW.email=email;
  MY_BIENS = Array.isArray(biens)? biens.slice() : null;
  IS_ADMIN=false;
  applyTabVisibility(); applyDataSource();
  showPreviewBanner();
  const d=document.querySelector('.tabs button[data-t="dash"]'); if(d) d.click();
  buildFilters(); render();
}
function exitPreview(){
  if(!PREVIEW.active) return;
  MY_BIENS=PREVIEW.savedMyBiens; IS_ADMIN=PREVIEW.savedIsAdmin;
  PREVIEW.active=false; PREVIEW.email=null;
  applyTabVisibility(); applyDataSource();
  hidePreviewBanner();
  buildFilters(); render();
}
function showPreviewBanner(){
  let b=document.getElementById('previewBar');
  if(!b){ b=document.createElement('div'); b.id='previewBar';
    b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99998;background:linear-gradient(90deg,#8957e5,#6f42c1);color:#fff;padding:8px 16px;font:600 13px/1.35 -apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 12px rgba(0,0,0,.35)';
    document.body.appendChild(b); }
  b.innerHTML='👁 Aperçu en tant que <strong style="margin:0 4px">'+(PREVIEW.email||'')+'</strong> — lecture seule <button id="btnExitPreview" style="margin-left:8px;background:#fff;color:#4b2e83;border:none;border-radius:6px;padding:4px 12px;font-weight:700;cursor:pointer">Quitter l’aperçu</button>';
  document.getElementById('btnExitPreview').onclick=exitPreview;
  b.style.display='flex'; document.body.style.paddingTop='40px';
}
function hidePreviewBanner(){ const b=document.getElementById('previewBar'); if(b) b.style.display='none'; document.body.style.paddingTop=''; }
```

- [ ] **Step 5 : Vérifier via la console**

Connecté en admin, dans la console :
```js
enterPreview('bibizfamilylodge@gmail.com', ['Ambassador','Lodge']);
```
Attendu : bandeau violet en haut « Aperçu en tant que … » ; boutons de filtre biens réduits à Ambassador/Lodge ; onglets Admin, Calendrier, Tarification, Validation et « + Nouvelle saisie » masqués ; le nombre de nuitées correspond à la somme réelle des 2 biens (≈ 288 pour 2026, PAS 419 ni 580).
Puis :
```js
exitPreview();
```
Attendu : bandeau disparaît, retour à 3 biens et tous les onglets admin.

- [ ] **Step 6 : Commit**

```bash
git add index.html
git commit -m "$(printf 'Apercu: etat PREVIEW, entree/sortie, visibilite des onglets\n\nenterPreview/exitPreview simulent MY_BIENS/IS_ADMIN de la cible,\nmasquent les onglets admin/expert/saisie et affichent un bandeau.\nReversible sans rechargement.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3 : Sélecteur « Voir en tant que » dans le panneau Admin

**Files:**
- Modify: `index.html` (HTML du `#v-admin` ~775 ; `renderAdmin()` ~1798-1804)

**Interfaces:**
- Consumes: `enterPreview(email, biens)` (Task 2), la variable `rows` de `renderAdmin` (lignes `authorized_emails`).

- [ ] **Step 1 : Ajouter la carte HTML dans `#v-admin`**

Repérer (ligne ~775) :
```html
<div class="view" id="v-admin">
  <div class="card">
    <h3>Gestion des accès <span class="hint" id="adminCount"></span></h3>
```
Insérer une nouvelle carte entre `<div class="view" id="v-admin">` et `<div class="card">` :
```html
<div class="view" id="v-admin">
  <div class="card" id="previewAsCard">
    <h3>Voir en tant que <span class="hint">aperçu du périmètre d'un utilisateur · lecture seule</span></h3>
    <div class="desc">Visualisez l'outil avec les biens et les onglets d'un utilisateur, sans vous déconnecter et sans son mot de passe. Aucune modification n'est possible pendant l'aperçu.</div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <select id="selPreviewUser" style="flex:1;min-width:240px;background:var(--panel2);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:9px 11px;font-size:13.5px"></select>
      <button class="btn" id="btnPreviewAs">Activer l'aperçu</button>
    </div>
  </div>
  <div class="card">
    <h3>Gestion des accès <span class="hint" id="adminCount"></span></h3>
```

- [ ] **Step 2 : Peupler le sélecteur et câbler le bouton dans `renderAdmin()`**

Repérer, dans `renderAdmin` (ligne ~1804) :
```js
  document.querySelectorAll('#adminBody .bienchip').forEach(b=>b.onclick=()=>toggleUserBien(b.dataset.em,b.dataset.b,rows));
```
Ajouter juste après :
```js
  const _sel=document.getElementById('selPreviewUser');
  if(_sel){ _sel.innerHTML='<option value="">— choisir un utilisateur —</option>'+rows.map(r=>{ const list=Array.isArray(r.biens_autorises)?r.biens_autorises:null; return '<option value="'+r.email+'" data-biens="'+(list?list.join('|'):'')+'">'+r.email+(list?' ('+list.length+' bien'+(list.length>1?'s':'')+')':' (tous les biens)')+'</option>'; }).join(''); }
  const _bpa=document.getElementById('btnPreviewAs');
  if(_bpa) _bpa.onclick=function(){ const s=document.getElementById('selPreviewUser'); if(!s||!s.value) return; const opt=s.options[s.selectedIndex]; const bs=(opt.getAttribute('data-biens')||''); enterPreview(s.value, bs? bs.split('|') : null); };
```

- [ ] **Step 3 : Vérifier de bout en bout**

Connecté en admin → onglet **Admin** → la carte « Voir en tant que » apparaît, le menu liste les utilisateurs autorisés. Choisir Marc → « Activer l'aperçu » → l'aperçu s'active (bandeau, 2 biens, onglets réduits). « Quitter l'aperçu » → retour normal.

- [ ] **Step 4 : Commit**

```bash
git add index.html
git commit -m "$(printf 'Apercu: selecteur Voir en tant que dans le panneau Admin\n\nCarte dediee dans #v-admin, menu peuple depuis authorized_emails,\nbouton qui declenche enterPreview avec les biens autorises.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4 : Lecture seule (gardes d'écriture)

Les onglets d'écriture sont masqués en aperçu, mais les boutons éditer/supprimer des Réservations restent atteignables : on ajoute une garde logique sur tous les points d'écriture accessibles à un non-admin.

**Files:**
- Modify: `index.html` (`saveForm` ~1389 ; `actDelete` ~1420 ; `actRestore` ~1426 ; `actEdit` ~1419 ; `saveObjectives`)

**Interfaces:**
- Consumes: `PREVIEW.active` (Task 2), `toast(msg)` (existant).

- [ ] **Step 1 : Garder `saveForm`**

Repérer (ligne ~1389) :
```js
async function saveForm(){
```
Insérer en première ligne du corps :
```js
async function saveForm(){
  if(PREVIEW.active){ toast('Lecture seule en mode aperçu.'); return; }
```

- [ ] **Step 2 : Garder `actEdit`, `actDelete`, `actRestore`**

Repérer (lignes ~1419-1426) :
```js
async function actEdit(id){ const r=ROWS.find(x=>x.id===id); if(r) enterEditMode(r); }
async function actDelete(id){
  const r=ROWS.find(x=>x.id===id); if(!r) return;
```
Remplacer par :
```js
async function actEdit(id){ if(PREVIEW.active){ toast('Lecture seule en mode aperçu.'); return; } const r=ROWS.find(x=>x.id===id); if(r) enterEditMode(r); }
async function actDelete(id){
  if(PREVIEW.active){ toast('Lecture seule en mode aperçu.'); return; }
  const r=ROWS.find(x=>x.id===id); if(!r) return;
```
Et repérer (ligne ~1426) :
```js
async function actRestore(id){
```
Insérer la garde :
```js
async function actRestore(id){
  if(PREVIEW.active){ toast('Lecture seule en mode aperçu.'); return; }
```

- [ ] **Step 3 : Garder `saveObjectives`**

Localiser la définition `function saveObjectives(` (câblée sur `#btnSaveObj` ~ligne 1484) et insérer en première ligne de son corps :
```js
  if(PREVIEW.active){ toast('Lecture seule en mode aperçu.'); return; }
```

- [ ] **Step 4 : Vérifier**

En aperçu (Task 3), aller dans **Réservations**, cliquer « supprimer » ou « éditer » sur une ligne → rien ne se passe hormis un toast « Lecture seule en mode aperçu. ». Aller dans **Objectifs & point mort** (visible car non-admin y a accès) → « Enregistrer les objectifs » → bloqué avec toast. Quitter l'aperçu → les écritures refonctionnent.

- [ ] **Step 5 : Commit**

```bash
git add index.html
git commit -m "$(printf 'Apercu: lecture seule (gardes d ecriture)\n\nsaveForm, actEdit, actDelete, actRestore, saveObjectives refusent\ntoute ecriture quand PREVIEW.active, avec un toast explicite.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5 : Helper `hasUnsavedInput()` (anti-cache, partie 1)

**Files:**
- Modify: `index.html` (nouvelle fonction avant le contrôle de version, ~ligne 987)

**Interfaces:**
- Produces: `hasUnsavedInput() => boolean` — vrai si une saisie/édition est en cours.

- [ ] **Step 1 : Ajouter la fonction**

Repérer (ligne ~987) :
```js
// ===== Détecteur de nouvelle version (anti-cache) =====
const APP_BUILD='20260712-221022';
```
Insérer juste **avant** ce commentaire :
```js
function hasUnsavedInput(){
  try{ if(typeof state!=='undefined' && state.editId!=null) return true; }catch(e){}
  const ids=['inLogement','inEntree','inSortie','inNom','inMontant'];
  for(const id of ids){ const el=document.getElementById(id); if(el && (''+el.value).trim()!=='') return true; }
  const vm=document.getElementById('valModal'); if(vm && vm.style.display && vm.style.display!=='none') return true;
  return false;
}
```

- [ ] **Step 2 : Vérifier via la console**

Connecté, onglet Tableau de bord (aucune saisie) → `hasUnsavedInput()` renvoie `false`. Ouvrir « + Nouvelle saisie », taper un nom dans le champ Nom → `hasUnsavedInput()` renvoie `true`. Vider le champ → `false`.

- [ ] **Step 3 : Commit**

```bash
git add index.html
git commit -m "$(printf 'Anti-cache: helper hasUnsavedInput (saisie/edition en cours)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6 : Forçage anti-cache (réaction du contrôle de version)

**Files:**
- Modify: `index.html` (IIFE du contrôle de version ~988-1006)

**Interfaces:**
- Consumes: `hasUnsavedInput()` (Task 5), `APP_BUILD` (existant).

- [ ] **Step 1 : Remplacer l'IIFE du contrôle de version**

Repérer le bloc (lignes ~989-1006), commençant par `(function(){ if(typeof window==='undefined'...` et finissant par `})();` (juste après `window.addEventListener('focus', check);`). Le remplacer intégralement par :
```js
(function(){ if(typeof window==='undefined'||typeof document==='undefined')return; let done=false;
  function forceReload(build){ try{ if(sessionStorage.getItem('al_reloaded_build')===build){ showBanner(); return; } sessionStorage.setItem('al_reloaded_build',build); }catch(e){} location.href=location.pathname+'?v='+Date.now(); }
  function showBanner(){ if(done||document.getElementById('newVerBar')||!document.body)return; done=true;
    const d=document.createElement('div'); d.id='newVerBar';
    d.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#1d9e75;color:#04221a;padding:10px 16px;font:600 13px/1.35 -apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 -4px 16px rgba(0,0,0,.35)';
    d.innerHTML='🔄 Une nouvelle version de l’outil est disponible. Enregistrez votre saisie puis rechargez.&nbsp;<button id="newVerReload" style="background:#04221a;color:#fff;border:none;border-radius:7px;padding:6px 14px;font-weight:700;cursor:pointer">Recharger</button>';
    document.body.appendChild(d);
    document.getElementById('newVerReload').onclick=function(){ location.href=location.pathname+'?v='+Date.now(); };
  }
  async function check(){ if(done)return; try{
      const r=await fetch(location.pathname+'?cb='+Date.now(),{cache:'no-store'}); if(!r.ok)return;
      const txt=await r.text(); const m=txt.match(/APP_BUILD='([^']+)'/);
      if(m&&m[1]&&m[1]!==APP_BUILD){ if(hasUnsavedInput()) showBanner(); else forceReload(m[1]); }
    }catch(e){} }
  setTimeout(check, 8000); setInterval(check, 300000);
  document.addEventListener('visibilitychange',function(){ if(!document.hidden) check(); });
  window.addEventListener('focus', check);
})();
```
Changements par rapport à l'existant : suppression du bouton de fermeture (`newVerClose`) → bandeau non-ignorable ; ajout de `forceReload` (avec garde anti-boucle `sessionStorage.al_reloaded_build`) ; `check()` recharge automatiquement si aucune saisie en cours, sinon affiche le bandeau.

- [ ] **Step 2 : Vérifier (simulation de nouvelle version)**

Ouvrir `index.html` localement, se connecter. Dans la console, forcer un faux « nouveau build » distant en interceptant le fetch, ou plus simple : dupliquer le fichier en changeant `APP_BUILD`, servir via `python3 -m http.server` et pointer le contrôle dessus. Scénario A (aucune saisie) → la page se recharge **une seule fois** (vérifier que `sessionStorage.al_reloaded_build` est posé et qu'il n'y a pas de boucle). Scénario B : ouvrir « + Nouvelle saisie », remplir le Nom, refaire la détection → **pas** de rechargement, bandeau vert non-ignorable, clic « Recharger » recharge.

- [ ] **Step 3 : Commit**

```bash
git add index.html
git commit -m "$(printf 'Anti-cache: rechargement auto si pas de saisie, bandeau sinon\n\nLe controle de version recharge automatiquement vers la nouvelle\nversion quand aucune saisie n est en cours (garde anti-boucle via\nsessionStorage), sinon affiche un bandeau non-ignorable.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Vérification finale (end-to-end)

1. Connecté admin : tableau de bord identique à avant (3 biens, 419 nuitées 2026). Aucune régression.
2. Admin → « Voir en tant que » Marc → aperçu : 2 biens, ~288 nuitées, onglets réduits, bandeau, écritures bloquées.
3. « Quitter l'aperçu » → retour admin complet, sans rechargement.
4. Anti-cache : simulation build → rechargement auto sans saisie ; bandeau non-ignorable avec saisie en cours ; pas de boucle.
5. Non-régression pour un vrai non-admin (si un compte de test est disponible) : ses chiffres restent corrects (RLS + filtre = cohérents).

## Notes d'exécution

- Le déblocage réel de Marc/Fabrice dépend du déploiement (push) + de la Task 6. Rappel : un cache antérieur au contrôle de version nécessitera **un** rechargement forcé manuel une seule fois (voir spec §3.5).
- Aucun `git push` sans validation de l'utilisateur.
