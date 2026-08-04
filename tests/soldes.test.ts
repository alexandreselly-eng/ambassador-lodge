// Ventilation du solde d'une réservation entre deux questions distinctes :
//   reste    ce que le VOYAGEUR doit encore
//   attendu  ce que la PLATEFORME doit encore verser
//
// « Réglé » ne veut pas dire « encaissé » : Airbnb et Booking ne reversent qu'après l'arrivée
// du voyageur. Sans cette distinction, un séjour de novembre payé aujourd'hui était compté
// comme de l'argent déjà reçu. Signalé le 04/08/2026 sur 19 séjours, 41 113 €.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUJ = '2026-08-04';

/** Extrait les fonctions de ventilation d'index.html, sans le reste de l'app. */
function charger() {
  const html = readFileSync(join(RACINE, 'index.html'), 'utf8');
  const debut = html.indexOf('const PAIEMENTS_SOLDES=');
  const fin = html.indexOf('function compute(r){', debut);
  assert.ok(debut > 0 && fin > debut, 'bloc de ventilation introuvable dans index.html');
  const bac: any = { module: { exports: {} }, console };
  vm.createContext(bac);
  vm.runInContext(
    html.slice(debut, fin) +
      '\nmodule.exports = { VENTILER_SOLDE, SOLDE_REGLE, SUR_PLATEFORME, _aujourdhui };',
    bac,
  );
  return bac.module.exports;
}

const { VENTILER_SOLDE, SOLDE_REGLE, SUR_PLATEFORME, _aujourdhui } = charger();

const resa = (o: Record<string, unknown>) => ({ entree: '2026-01-01', ...o });

// L'objet rendu vient du bac à sable : on le recopie dans ce realm, sinon deepStrictEqual
// refuse la comparaison sur le prototype alors que la structure est identique.
const ventiler = (r: any, brut: number | null) => {
  const o = VENTILER_SOLDE(r, brut, AUJ);
  return { reste: o.reste, attendu: o.attendu };
};

describe('ventilation du solde', () => {
  test('un séjour à venir sur plateforme est attendu, pas encaissé', () => {
    const r = resa({ plateforme: 'Airbnb.com', paiement: 'MANAGED_BY_PLATFORM', entree: '2026-11-08' });
    assert.deepEqual(ventiler(r, 1000), { reste: 0, attendu: 1000 });
  });

  test('un séjour commencé ou passé sur plateforme est encaissé', () => {
    for (const entree of ['2026-08-04', '2026-01-01']) {
      const r = resa({ plateforme: 'Booking.com', paiement: 'PAID', entree });
      assert.deepEqual(ventiler(r, 1000), { reste: 0, attendu: 0 }, `arrivée ${entree}`);
    }
  });

  test('un séjour direct payé est encaissé, même à venir : le virement est sur le compte', () => {
    for (const p of ['Direct', 'Website']) {
      const r = resa({ plateforme: p, paiement: 'PAID', entree: '2026-12-01' });
      assert.deepEqual(ventiler(r, 1000), { reste: 0, attendu: 0 }, p);
    }
  });

  test('un impayé reste un solde client, quels que soient le canal et la date', () => {
    for (const p of ['Direct', 'Website', 'Airbnb.com']) {
      for (const paiement of ['UNPAID', 'PARTIALLY_PAID']) {
        const r = resa({ plateforme: p, paiement, entree: '2026-12-01' });
        assert.deepEqual(ventiler(r, 800), { reste: 800, attendu: 0 }, `${p} ${paiement}`);
      }
    }
  });

  test('un état de paiement absent ou inconnu ne suppose jamais un encaissement', () => {
    for (const paiement of [null, undefined, '', 'CANCELED', 'CODE_INEDIT']) {
      const r = resa({ plateforme: 'Airbnb.com', paiement, entree: '2026-12-01' });
      assert.deepEqual(ventiler(r, 500), { reste: 500, attendu: 0 }, String(paiement));
    }
  });

  test('les saisies manuelles gardent le calcul par acomptes', () => {
    // Pas d'état de paiement : rien n'est soldé automatiquement, rien n'est attendu.
    const r = resa({ origine: 'Immosphera', entree: '2026-12-01' });
    assert.deepEqual(ventiler(r, 300), { reste: 300, attendu: 0 });
  });

  test('un solde inconnu le reste, et n alimente aucun des deux chiffres', () => {
    const r = resa({ plateforme: 'Airbnb.com', paiement: 'PAID' });
    assert.deepEqual(ventiler(r, null), { reste: null, attendu: 0 });
  });

  test('le canal est reconnu depuis plateforme ou, à défaut, origine', () => {
    assert.equal(SUR_PLATEFORME({ plateforme: 'Airbnb.com' }), true);
    assert.equal(SUR_PLATEFORME({ plateforme: 'Booking.com' }), true);
    assert.equal(SUR_PLATEFORME({ origine: 'Airbnb' }), true);
    assert.equal(SUR_PLATEFORME({ plateforme: 'Website' }), false);
    assert.equal(SUR_PLATEFORME({ plateforme: 'Direct' }), false);
    assert.equal(SUR_PLATEFORME({}), false);
  });

  test('_aujourdhui rend une date locale comparable aux dates d arrivée', () => {
    assert.match(_aujourdhui(), /^\d{4}-\d{2}-\d{2}$/);
  });

  test('SOLDE_REGLE ne solde que les trois états connus', () => {
    for (const p of ['MANAGED_BY_PLATFORM', 'PAID', 'PAID_MANUALLY']) assert.ok(SOLDE_REGLE(p));
    for (const p of ['UNPAID', 'PARTIALLY_PAID', 'CANCELED', null, '']) assert.equal(SOLDE_REGLE(p), false);
  });
});
