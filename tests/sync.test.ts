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

/** Construit un faux client Supabase enregistrant ce qu'on lui demande. */
function faireSupa(lignes: any[]) {
  const journal: any = { updates: [], invocations: 0, selects: [] };
  const supa = {
    from(table: string) {
      const q: any = {
        _table: table,
        select(_cols: string, opts?: any) {
          journal.selects.push(table);
          if (opts?.head) return Promise.resolve({ count: lignes.length, error: null });
          return q;
        },
        eq() { return q; },
        order() { return Promise.resolve({ data: lignes, error: null }); },
        maybeSingle() { return Promise.resolve({ data: { last_status: 'ok' }, error: null }); },
        update(patch: any) { journal.updates.push({ table, patch, ids: null }); return q; },
        in(_col: string, ids: string[]) {
          const dernier = journal.updates[journal.updates.length - 1];
          if (dernier) dernier.ids = ids;
          return Promise.resolve({ error: null });
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

  test('charger rend des copies : la modale mute ses lignes', async () => {
    const { supa } = faireSupa(lignes);
    const { AL_SYNC } = chargerAlSync(supa);
    const rows = await AL_SYNC.charger();
    assert.equal(rows.length, 2);
    rows[0]._bien = 'Ambassador';
    assert.equal(lignes[0].payload._bien, undefined, 'le payload d origine ne doit pas etre mute');
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
