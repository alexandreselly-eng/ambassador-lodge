// Toute ECRITURE en base doit vérifier son erreur.
//
// Le 04/08/2026, l'écriture de sh_sync_state échouait depuis des heures sans que rien ne le
// dise : `await db.from(...).upsert(...)` sans capturer `error`. La synchro se déclarait
// réussie, le curseur restait figé, et elle relisait la même fenêtre à chaque passage.
// C'était la panne silencieuse à l'intérieur du code écrit pour détecter les pannes
// silencieuses.
//
// Ce test remplace la vigilance par une vérification.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(RACINE, 'supabase/functions/superhote-sync/index.ts'), 'utf8');

/** Découpe le source en instructions, pour examiner chacune isolément. */
function instructions(code: string): string[] {
  return code.split(/\n\s*\n/).flatMap((bloc) => bloc.split(/;\s*\n/));
}

describe('aucune écriture en base ne peut échouer en silence', () => {
  const ECRITURES = ['.upsert(', '.update(', '.insert(', '.delete('];

  for (const methode of ECRITURES) {
    test(`chaque ${methode.replace(/[.(]/g, '')} capture son erreur`, () => {
      const fautives = instructions(src)
        .filter((i) => i.includes(methode) && i.includes('db.from('))
        .filter((i) => !/\b(error|errEtat|erreur)\b/.test(i));
      assert.deepEqual(
        fautives.map((f) => f.trim().slice(0, 120)),
        [],
        `une ecriture ignore son erreur : elle echouerait sans que rien ne le signale`,
      );
    });
  }

  test("l'ecriture d'etat du chemin de succes leve, elle ne journalise pas", () => {
    // Sur le chemin de succes, une ecriture d'etat perdue doit faire echouer l'appel, donc
    // alerter. La journaliser suffirait a la rendre invisible : personne ne lit les journaux.
    assert.match(src, /if \(errEtat\) throw echec\('Ecriture de sh_sync_state'/);
  });

  test("l'ecriture d'etat du chemin d'erreur journalise, elle ne leve pas", () => {
    // On y est deja en erreur et l'alerte est partie : relancer remplacerait un message utile
    // par un message de plomberie.
    assert.match(src, /if \(errEtat\) console\.error\(/);
  });

  test('les lectures critiques verifient aussi leur erreur', () => {
    for (const motif of ['properties', 'sh_pending']) {
      const lignes = instructions(src).filter((i) => i.includes(`'${motif}'`) && i.includes('.select('));
      assert.ok(lignes.length > 0, `aucune lecture de ${motif} trouvee`);
      const sansControle = lignes.filter((i) => !/\berror\b/.test(i));
      assert.deepEqual(sansControle.map((l) => l.trim().slice(0, 100)), [], `lecture de ${motif} sans controle`);
    }
  });
});
