// Le tableau des réservations a DEUX en-têtes : celui du tableau principal, statique dans le
// HTML (thead#rthead), et reservHeadHTML() pour les tableaux dépliés. Les cellules viennent
// d'un troisième endroit, reservRowHTML(). Ajouter une colonne à un seul des trois décale
// silencieusement toutes les valeurs de la ligne.
//
// Ce test remplace un commentaire « penser aux trois endroits ».

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(RACINE, 'index.html'), 'utf8');

/** Bloc source d'une fonction, de sa déclaration à la fonction suivante. */
function corps(nom: string): string {
  const d = html.indexOf(`function ${nom}(`);
  assert.ok(d > 0, `${nom} introuvable`);
  const f = html.indexOf('\nfunction ', d + 1);
  return html.slice(d, f > d ? f : d + 4000);
}

const enteteStatique = (() => {
  const d = html.indexOf('<thead id="rthead">');
  assert.ok(d > 0, 'thead#rthead introuvable');
  return html.slice(d, html.indexOf('</thead>', d));
})();

const compter = (s: string, motif: RegExp) => (s.match(motif) || []).length;

describe('cohérence des colonnes du tableau des réservations', () => {
  const nStatique = compter(enteteStatique, /<th[\s>]/g);
  const nDeplie = compter(corps('reservHeadHTML'), /<th[\s>]/g);
  const nCellules = compter(corps('reservRowHTML'), /<td[\s>]/g);

  test('les deux en-têtes listent le même nombre de colonnes', () => {
    assert.equal(nStatique, nDeplie, `thead#rthead ${nStatique} vs reservHeadHTML ${nDeplie}`);
  });

  test('la ligne a autant de cellules que l en-tête a de colonnes', () => {
    assert.equal(nCellules, nStatique, `reservRowHTML ${nCellules} <td> vs ${nStatique} <th>`);
  });

  test('les deux colonnes de solde sont presentes et distinctes', () => {
    for (const source of [enteteStatique, corps('reservHeadHTML')]) {
      assert.match(source, /Reste à payer/, 'colonne des soldes clients');
      assert.match(source, /Versement attendu/, 'colonne des versements de plateforme');
    }
    const ligne = corps('reservRowHTML');
    assert.match(ligne, /d\.reste_a_payer/);
    assert.match(ligne, /d\.encaissement_attendu/);
  });

  test('la ventilation par mois transporte les deux champs', () => {
    // Sans cela, la colonne serait vide des que le prorata mensuel est actif.
    const src = html.slice(html.indexOf('_split:al.length>1'));
    const bloc = src.slice(0, 1200);
    assert.match(bloc, /reste_a_payer:_pr\(d\.reste_a_payer,f\)/);
    assert.match(bloc, /encaissement_attendu:_pr\(d\.encaissement_attendu,f\)/);
  });
});
