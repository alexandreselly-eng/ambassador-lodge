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
import vm from 'node:vm';

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

  // reservFootHTML est exécutée plutôt que lue : cinq de ses cellules viennent d'un helper,
  // les compter dans le source donnerait un faux résultat.
  const rendreFoot = (rows: any[], label?: string) => {
    const bac: any = { module: { exports: {} }, eur: (v: number) => `${v} EUR`, css: () => '#000' };
    vm.createContext(bac);
    vm.runInContext(corps('reservFootHTML') + '\nmodule.exports = reservFootHTML;', bac);
    return (bac.module.exports as Function)(rows, label) as string;
  };

  test('la ligne de totaux couvre exactement toutes les colonnes', () => {
    const html = rendreFoot([{ nuitees: 2, montant: 100, benefice: 80, reste_a_payer: 0, encaissement_attendu: 50, commission: 20 }]);
    const cellules = html.match(/<td[^>]*>/g) || [];
    const colspans = [...html.matchAll(/colspan="(\d+)"/g)].map((m) => Number(m[1]));
    const couvertes = colspans.reduce((s, n) => s + n, 0) + (cellules.length - colspans.length);
    assert.equal(couvertes, nStatique, `totaux : ${couvertes} colonnes couvertes contre ${nStatique} en-têtes`);
  });

  test('la ligne de totaux additionne bien, et compte les sejours', () => {
    const html = rendreFoot([
      { nuitees: 2, montant: 100, commission: 10, benefice: 90, reste_a_payer: 30, encaissement_attendu: 0 },
      { nuitees: 3, montant: 200, commission: 20, benefice: 180, reste_a_payer: 0, encaissement_attendu: 70 },
    ]);
    assert.match(html, /2 séjours/);
    assert.match(html, />5</, 'somme des nuitées');
    assert.match(html, /300 EUR/, 'somme des montants');
    assert.match(html, /30 EUR/, 'somme des restes clients');
    assert.match(html, /70 EUR/, 'somme des versements attendus');
  });

  test('la commission recalculee par l app prime sur celle de la ligne', () => {
    // _appComm est la commission recalculee au barème apporteur : c'est elle qui s'affiche
    // dans la cellule, le total doit donc la suivre.
    const html = rendreFoot([{ commission: 999, _appComm: 42, montant: 100 }]);
    assert.match(html, /42 EUR/);
    assert.ok(!html.includes('999 EUR'), 'la commission brute ne doit pas etre sommee');
  });

  test('un tableau vide n affiche pas de ligne de totaux', () => {
    assert.equal(rendreFoot([]), '');
  });

  const grouper = (rows: any[], champ: string) => {
    const bac: any = { module: { exports: {} } };
    vm.createContext(bac);
    vm.runInContext(corps('GROUPER') + '\nmodule.exports = GROUPER;', bac);
    const g = (bac.module.exports as Function)(rows, champ) as any[];
    // Recopie dans ce realm : .map() sur un tableau du bac a sable rendrait encore un
    // tableau du bac a sable, que deepStrictEqual refuserait de comparer.
    return [...g].map((x) => ({ cle: x.cle, lignes: [...x.lignes] }));
  };

  test('le regroupement conserve le tri a l interieur de chaque groupe', () => {
    const rows = [
      { logement: 'Lodge', entree: '2026-03-01' },
      { logement: 'Ambassador', entree: '2026-02-01' },
      { logement: 'Lodge', entree: '2026-01-01' },
    ];
    const g = grouper(rows, 'logement');
    assert.deepEqual(g.map((x) => x.cle), ['Lodge', 'Ambassador'], 'ordre d apparition conserve');
    assert.deepEqual(
      g[0].lignes.map((l: any) => l.entree),
      ['2026-03-01', '2026-01-01'],
      'le tri demande ne doit pas etre defait par le regroupement',
    );
  });

  test('une valeur de groupe absente est nommee, pas silencieuse', () => {
    const g = grouper([{ origine: '' }, { origine: null }, { origine: 'Airbnb' }], 'origine');
    assert.deepEqual(g.map((x) => x.cle), ['(non renseigné)', 'Airbnb']);
    assert.equal(g[0].lignes.length, 2);
  });

  test('les trois choix de regroupement sont proposes', () => {
    for (const g of ['none', 'logement', 'origine']) {
      assert.match(html, new RegExp(`data-grp="${g}"`), `bouton ${g}`);
    }
  });

  test('la ventilation par mois transporte les deux champs', () => {
    // Sans cela, la colonne serait vide des que le prorata mensuel est actif.
    const src = html.slice(html.indexOf('_split:al.length>1'));
    const bloc = src.slice(0, 1200);
    assert.match(bloc, /reste_a_payer:_pr\(d\.reste_a_payer,f\)/);
    assert.match(bloc, /encaissement_attendu:_pr\(d\.encaissement_attendu,f\)/);
  });
});
