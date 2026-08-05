// Garde-fou contre l'effacement massif.
//
// Une validation ECRASE integralement les lignes du bien : `upsert({ rows: sub })` remplace
// tout. La completude du jeu transmis reposait entierement sur l'appelant, sans aucun filet.
// Le 05/08/2026, un sas de 2 lignes a propose la suppression de 75 reservations. Seul l'oeil
// humain s'y opposait, et un utilisateur presse aurait cliqué.
//
// Le seuil ci-dessous protege TOUS les appelants, presents et futurs, quel que soit
// l'utilisateur. Il ne remplace pas la lecture de la modale, il rattrape le clic distrait.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(RACINE, 'index.html'), 'utf8');

function corps(nom: string): string {
  const d = html.indexOf(`function ${nom}(`);
  assert.ok(d > 0, `${nom} introuvable`);
  const f = html.indexOf('\n  async function ', d + 1);
  return html.slice(d, f > d ? f : d + 2000);
}

const bac: any = { module: { exports: {} } };
vm.createContext(bac);
vm.runInContext(corps('SUPPRESSION_MASSIVE') + '\nmodule.exports = SUPPRESSION_MASSIVE;', bac);
const SUPPRESSION_MASSIVE = bac.module.exports as (s: number, a: number) => boolean;

describe('seuil de suppression', () => {
  test('aucune suppression ne declenche rien', () => {
    assert.equal(SUPPRESSION_MASSIVE(0, 200), false);
    assert.equal(SUPPRESSION_MASSIVE(null as any, 200), false);
    assert.equal(SUPPRESSION_MASSIVE(undefined as any, 200), false);
  });

  test('quelques suppressions passent : une annulation reste normale', () => {
    assert.equal(SUPPRESSION_MASSIVE(1, 200), false);
    assert.equal(SUPPRESSION_MASSIVE(4, 200), false);
  });

  test('cinq suppressions ou plus declenchent, meme sur un gros jeu', () => {
    assert.equal(SUPPRESSION_MASSIVE(5, 200), true);
    assert.equal(SUPPRESSION_MASSIVE(75, 200), true);
  });

  test('une proportion forte declenche, meme sur un petit jeu', () => {
    // 2 sur 12 : sous le seuil absolu, mais 17 % du bien.
    assert.equal(SUPPRESSION_MASSIVE(2, 12), true);
    assert.equal(SUPPRESSION_MASSIVE(1, 30), false);
  });

  test('le cas reel du 05/08/2026 aurait ete arrete', () => {
    // Sas de 2 lignes contre une memoire de 75 : 73 suppressions proposees.
    assert.equal(SUPPRESSION_MASSIVE(73, 75), true);
  });

  test('une premiere validation, sans memoire, ne declenche pas', () => {
    assert.equal(SUPPRESSION_MASSIVE(0, 0), false);
  });
});

describe('cablage du garde-fou et de l archivage', () => {
  test('commit refuse sans autorisation explicite', () => {
    assert.match(html, /SUPPRESSION_MASSIVE\(d\.removed\.length,_avant\) && autorise!==true/);
    assert.match(html, /Refus de sécurité/);
  });

  test('la modale demande une confirmation distincte du clic habituel', () => {
    assert.match(html, /SUPPRESSION IMPORTANTE/);
    assert.match(html, /_autorise=confirm\(/);
    // Sans confirmation, on sort sans rien ecrire.
    assert.match(html, /if\(!_autorise\)\{ ok\.disabled=false;/);
  });

  test("l'archivage precede l'ecrasement, et l'echec de l'archivage annule tout", () => {
    const c = html.indexOf('async function commit(source');
    const bloc = html.slice(c, c + 3000);
    const iArchive = bloc.indexOf('data_snapshots_historique');
    const iEcrase = bloc.indexOf("from('data_snapshots').upsert");
    assert.ok(iArchive > 0 && iEcrase > 0, 'archivage ou ecrasement introuvable');
    assert.ok(iArchive < iEcrase, "l'archivage doit precoder l'ecrasement, sinon il n'archive rien");
    assert.match(bloc, /Sauvegarde du jeu remplacé impossible, rien n'a été écrasé/);
  });
});
