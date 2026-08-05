// Tests du module AL_SYNC (Lot 3) : le pont entre le sas sh_pending et la modale de
// validation. Le module est extrait de index.html et exécuté avec un Supabase simulé,
// pour vérifier son comportement sans toucher à la base ni au réseau.
//
//   node --test 'tests/*.test.ts'

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Faux client Supabase. `lignes` est le contenu de sh_pending, `snapshots` la mémoire déjà
 * validée telle qu'elle est rangée dans data_snapshots, un enregistrement par bien.
 */
function faireSupa(lignes: any[], snapshots: any[] = []) {
  const journal: any = { updates: [], invocations: 0, selects: [] };
  const supa = {
    from(table: string) {
      const q: any = {
        _table: table,
        select(_cols: string, opts?: any) {
          journal.selects.push(table);
          if (opts?.head) return Promise.resolve({ count: lignes.length, error: null });
          // data_snapshots se lit sans .order() : la promesse est resolue par .eq().
          if (table === 'data_snapshots') {
            const p: any = Promise.resolve({ data: snapshots, error: null });
            p.eq = () => Promise.resolve({ data: snapshots, error: null });
            return p;
          }
          return q;
        },
        eq() { return q; },
        order() { return Promise.resolve({ data: lignes, error: null }); },
        maybeSingle() { return Promise.resolve({ data: { last_status: 'ok' }, error: null }); },
        update(patch: any) { journal.updates.push({ table, patch, ids: null }); return q; },
        in(_col: string, valeurs: string[]) {
          // .in() sert a deux choses : filtrer les statuts du sas, et cibler un update.
          if (journal.updates.length && journal.updates[journal.updates.length - 1].ids === null) {
            journal.updates[journal.updates.length - 1].ids = valeurs;
            return Promise.resolve({ error: null });
          }
          return q;
        },
      };
      return q;
    },
    functions: {
      invoke() { journal.invocations++; return Promise.resolve({ data: { lues: 4 }, error: null }); },
    },
  };
  return { supa, journal };
}

/** Charge AL_SYNC depuis index.html dans un bac à sable, avec les dépendances simulées. */
function chargerAlSync(supa: any) {
  const html = readFileSync(join(RACINE, 'index.html'), 'utf8');
  const debut = html.indexOf('const AL_SYNC = (function(){');
  const fin = html.indexOf('const AL_VALID = (function(){', debut);
  assert.ok(debut > 0 && fin > debut, 'bloc AL_SYNC introuvable dans index.html');

  const bac: any = {
    module: { exports: {} },
    console,
    SUPA: supa,
    CURRENT_USER: { email: 'alexandre.selly@tera.re' },
    toasts: [] as any[],
    ouvertures: [] as any[],
    badges: 0,
  };
  bac.valToast = (m: string, err?: boolean) => bac.toasts.push({ m, err });
  bac.renderSyncBadge = () => { bac.badges++; };
  bac.AL_VALID = {
    openGate: (source: string, rows: any[], label: string, cb: Function) => {
      bac.ouvertures.push({ source, rows, label, cb });
      return Promise.resolve();
    },
  };
  vm.createContext(bac);
  vm.runInContext(html.slice(debut, fin) + '\nmodule.exports = AL_SYNC;', bac);
  return { AL_SYNC: bac.module.exports as any, bac };
}

describe('AL_SYNC : pont entre le sas et la modale', () => {
  let lignes: any[];

  beforeEach(() => {
    lignes = [
      { id: '1', payload: { id: '1', nom: 'A', montant: 100 }, updated_at: '2026-08-01T00:00:00Z' },
      { id: '2', payload: { id: '2', nom: 'B', montant: 200 }, updated_at: '2026-08-02T00:00:00Z' },
    ];
  });

  test('la source enregistree reste celle des snapshots deja valides', () => {
    const { supa } = faireSupa(lignes);
    const { AL_SYNC } = chargerAlSync(supa);
    assert.equal(
      AL_SYNC.SOURCE_SNAPSHOT,
      'superhote_csv',
      "changer cette cle orphelinerait les snapshots valides et casserait repriseTaxe()",
    );
  });

  // Le defaut du 05/08/2026 : charger() renvoyait le sas SEUL. diff() compte comme
  // suppression toute ligne en memoire absente de l'entrant, donc un sas de 2 lignes
  // proposait d'effacer les 75 autres. Invisible au premier import, qui recharge tout.
  test('le sas est applique PAR-DESSUS la memoire, il ne la remplace pas', async () => {
    const memoire = [
      { bien: 'Ambassador', rows: [{ id: '1', nom: 'A', montant: 100 }, { id: '9', nom: 'Z', montant: 900 }] },
      { bien: 'Lodge', rows: [{ id: '5', nom: 'L', montant: 500 }] },
    ];
    const { supa } = faireSupa(lignes, memoire);
    const { AL_SYNC } = chargerAlSync(supa);
    // Recopie dans ce realm : le tableau vient du bac a sable.
    const rows = [...(await AL_SYNC.charger())];
    const ids = rows.map((r: any) => String(r.id)).sort();
    assert.deepEqual(ids, ['1', '2', '5', '9'], 'les lignes non touchees par le sas doivent etre presentes');
    assert.equal(rows.find((r: any) => r.id === '1').montant, 100, 'la ligne 1 vient du sas et ecrase la memoire');
    assert.equal(rows.find((r: any) => r.id === '9').nom, 'Z', 'la ligne 9 est intacte, elle n est pas proposee en suppression');
  });

  test('une ligne marquee supprimee est bien retiree', async () => {
    const sas = [
      { id: '9', payload: { id: '9' }, updated_at: '2026-08-03T00:00:00Z', statut: 'supprime' },
      { id: '1', payload: { id: '1', montant: 111 }, updated_at: '2026-08-04T00:00:00Z', statut: 'en_attente' },
    ];
    const memoire = [{ bien: 'Ambassador', rows: [{ id: '1', montant: 100 }, { id: '9', montant: 900 }] }];
    const { supa } = faireSupa(sas, memoire);
    const { AL_SYNC } = chargerAlSync(supa);
    // Recopie dans ce realm : le tableau vient du bac a sable.
    const rows = [...(await AL_SYNC.charger())];
    assert.deepEqual(rows.map((r: any) => String(r.id)), ['1'], 'seule la suppression explicite retire une ligne');
    assert.equal(rows[0].montant, 111);
  });

  test('les lignes sans identifiant sont conservees, pas proposees en suppression', async () => {
    const memoire = [{ bien: 'Ambassador', rows: [{ nom: 'sans id', montant: 42 }] }];
    const { supa } = faireSupa(lignes, memoire);
    const { AL_SYNC } = chargerAlSync(supa);
    // Recopie dans ce realm : le tableau vient du bac a sable.
    const rows = [...(await AL_SYNC.charger())];
    assert.equal(rows.filter((r: any) => r.nom === 'sans id').length, 1);
  });

  test('charger rend des copies : la modale mute ses lignes', async () => {
    const memoire = [{ bien: 'Ambassador', rows: [{ id: '7', nom: 'M' }] }];
    const { supa } = faireSupa(lignes, memoire);
    const { AL_SYNC } = chargerAlSync(supa);
    // Recopie dans ce realm : le tableau vient du bac a sable.
    const rows = [...(await AL_SYNC.charger())];
    rows.forEach((r: any) => { r._bien = 'Ambassador'; });
    assert.equal(lignes[0].payload._bien, undefined, 'le payload du sas ne doit pas etre mute');
    assert.equal(memoire[0].rows[0]._bien, undefined, 'la memoire ne doit pas etre mutee');
  });

  test('marquerValides dedoublonne, ignore les identifiants vides et horodate', async () => {
    const { supa, journal } = faireSupa(lignes);
    const { AL_SYNC } = chargerAlSync(supa);
    const n = await AL_SYNC.marquerValides([
      { id: '1' }, { id: '1' }, { id: 2 }, { id: null }, { id: '' }, null,
    ]);
    assert.equal(n, 2, 'deux identifiants distincts');
    assert.equal(journal.updates.length, 1);
    // Les tableaux viennent du bac a sable : on les recopie dans ce realm avant comparaison.
    assert.deepEqual([...journal.updates[0].ids].sort(), ['1', '2']);
    assert.equal(journal.updates[0].patch.statut, 'valide');
    assert.equal(journal.updates[0].patch.traite_par, 'alexandre.selly@tera.re');
    assert.ok(journal.updates[0].patch.traite_le, 'traite_le doit etre horodate');
  });

  test('marquerValides n ecrit rien quand il n y a rien a marquer', async () => {
    const { supa, journal } = faireSupa(lignes);
    const { AL_SYNC } = chargerAlSync(supa);
    assert.equal(await AL_SYNC.marquerValides([]), 0);
    assert.equal(await AL_SYNC.marquerValides([{ nom: 'sans id' }]), 0);
    assert.equal(journal.updates.length, 0);
  });

  test('ouvrirValidation passe la source et les lignes a la modale', async () => {
    const { supa } = faireSupa(lignes);
    const { AL_SYNC, bac } = chargerAlSync(supa);
    await AL_SYNC.ouvrirValidation();
    assert.equal(bac.ouvertures.length, 1);
    assert.equal(bac.ouvertures[0].source, 'superhote_csv');
    assert.equal(bac.ouvertures[0].rows.length, 2);
    assert.match(bac.ouvertures[0].label, /^API SuperHote V2 · /);
  });

  test('un sas vide n ouvre pas la modale et le dit', async () => {
    const { supa } = faireSupa([]);
    const { AL_SYNC, bac } = chargerAlSync(supa);
    await AL_SYNC.ouvrirValidation();
    assert.equal(bac.ouvertures.length, 0, 'pas de modale vide');
    assert.equal(bac.toasts.length, 1);
    assert.match(bac.toasts[0].m, /aucun changement/i);
  });

  test('seules les lignes reellement validees sortent du sas', async () => {
    const { supa, journal } = faireSupa(lignes);
    const { AL_SYNC, bac } = chargerAlSync(supa);
    await AL_SYNC.ouvrirValidation();
    // La modale ne renvoie que les lignes dont le bien a ete reconnu : ici la 1 seulement.
    await bac.ouvertures[0].cb([{ id: '1' }]);
    assert.deepEqual([...journal.updates[0].ids], ['1']);
    assert.equal(bac.badges, 1, 'la pastille doit etre rafraichie apres validation');
  });

  test('declencher appelle la fonction et remonte l erreur applicative', async () => {
    const { supa, journal } = faireSupa(lignes);
    const { AL_SYNC } = chargerAlSync(supa);
    assert.deepEqual(await AL_SYNC.declencher(), { lues: 4 });
    assert.equal(journal.invocations, 1);

    // Une erreur metier arrive dans data.erreur avec un HTTP 200 cote client.
    supa.functions.invoke = () => Promise.resolve({ data: { erreur: 'SuperHote 422' }, error: null });
    await assert.rejects(() => AL_SYNC.declencher(), /SuperHote 422/);
  });
});
