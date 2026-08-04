// Surveillance de la synchronisation : distinguer l'échec du silence.
//
// L'échec s'annonce. Le silence non : une synchro qui ne tourne plus laisse last_status sur
// son dernier « ok », ce qui ressemble à un fonctionnement normal. C'est le scénario qui a
// laissé l'import CSV cassé du 12 au 31/07/2026 sans le moindre signal.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  corpsSur,
  diagnostic,
  peutAlerter,
  type EtatSync,
} from '../supabase/functions/superhote-sync/surveillance.ts';

const MAINTENANT = new Date('2026-08-04T12:00:00Z').getTime();
const ilYA = (h: number) => new Date(MAINTENANT - h * 3600 * 1000).toISOString();

describe('diagnostic de la synchro', () => {
  test('un passage récent et réussi ne dérange personne', () => {
    const d = diagnostic({ last_run_at: ilYA(3), last_status: 'ok' }, MAINTENANT);
    assert.equal(d.niveau, 'ok');
    assert.equal(d.alerte, false);
  });

  test('un échec alerte, avec son motif', () => {
    const d = diagnostic(
      { last_run_at: ilYA(2), last_status: 'erreur', last_error: 'SuperHote 401 : token refuse' },
      MAINTENANT,
    );
    assert.equal(d.niveau, 'echec');
    assert.equal(d.alerte, true);
    assert.match(d.message, /401/);
    assert.match(d.message, /2 h/);
  });

  // Le cas qui compte : rien n'a échoué, mais plus rien ne tourne.
  test('le silence alerte, alors que le dernier passage etait un succes', () => {
    const d = diagnostic({ last_run_at: ilYA(50), last_status: 'ok' }, MAINTENANT);
    assert.equal(d.niveau, 'silence');
    assert.equal(d.alerte, true);
    assert.match(d.message, /50 h/);
    assert.match(d.message, /arr[êe]t/i, 'le message doit orienter vers le declencheur, pas vers la fonction');
  });

  test('le seuil de silence tolère un passage manqué', () => {
    // Synchro quotidienne : 30 h, c'est un passage sauté, pas une panne.
    assert.equal(diagnostic({ last_run_at: ilYA(30), last_status: 'ok' }, MAINTENANT).niveau, 'ok');
    assert.equal(diagnostic({ last_run_at: ilYA(36), last_status: 'ok' }, MAINTENANT).niveau, 'silence');
  });

  test('le seuil est réglable', () => {
    assert.equal(diagnostic({ last_run_at: ilYA(10), last_status: 'ok' }, MAINTENANT, 8).niveau, 'silence');
    assert.equal(diagnostic({ last_run_at: ilYA(10), last_status: 'ok' }, MAINTENANT, 48).niveau, 'ok');
  });

  test('jamais executee : signale mais ne derange pas', () => {
    for (const e of [null, undefined, {} as EtatSync, { last_run_at: null }]) {
      const d = diagnostic(e as EtatSync | null, MAINTENANT);
      assert.equal(d.niveau, 'jamais');
      assert.equal(d.alerte, false, 'avant le premier passage, il n y a rien d anormal');
    }
  });

  test('le titre reste en ASCII : ntfy transporte mal les accents en en-tete', () => {
    const cas: Array<[EtatSync | null, string]> = [
      [{ last_run_at: ilYA(2), last_status: 'erreur' }, 'echec'],
      [{ last_run_at: ilYA(50), last_status: 'ok' }, 'silence'],
      [{ last_run_at: ilYA(1), last_status: 'ok' }, 'ok'],
      [null, 'jamais'],
    ];
    for (const [etat, attendu] of cas) {
      const d = diagnostic(etat, MAINTENANT);
      assert.equal(d.niveau, attendu);
      // eslint-disable-next-line no-control-regex
      assert.match(d.titre, /^[\x20-\x7E]+$/, `titre non ASCII : ${d.titre}`);
    }
  });
});

describe('anti-répétition', () => {
  test('la première alerte part toujours', () => {
    assert.equal(peutAlerter(null, MAINTENANT), true);
    assert.equal(peutAlerter(undefined, MAINTENANT), true);
    assert.equal(peutAlerter('pas une date', MAINTENANT), true);
  });

  test('une alerte récente bloque la suivante', () => {
    assert.equal(peutAlerter(ilYA(1), MAINTENANT), false);
    assert.equal(peutAlerter(ilYA(5), MAINTENANT), false);
    assert.equal(peutAlerter(ilYA(6), MAINTENANT), true);
    assert.equal(peutAlerter(ilYA(24), MAINTENANT), true);
  });

  test('l intervalle est réglable', () => {
    assert.equal(peutAlerter(ilYA(2), MAINTENANT, 1), true);
    assert.equal(peutAlerter(ilYA(2), MAINTENANT, 12), false);
  });
});

describe('corps du message', () => {
  // Le sujet ntfy est un secret de fait : sur le serveur public, quiconque le connaît lit
  // les messages. La troncature limite ce qu'une erreur inattendue laisserait fuir.
  test('le message est tronqué et mis sur une ligne', () => {
    assert.equal(corpsSur('  a\n\n  b  '), 'a b');
    const long = 'x'.repeat(1000);
    const c = corpsSur(long);
    assert.equal(c.length, 400);
    assert.ok(c.endsWith('…'));
  });

  test('un message vide ou absent ne casse rien', () => {
    assert.equal(corpsSur(''), '');
    assert.equal(corpsSur(undefined as any), '');
  });

  test('la limite est réglable', () => {
    assert.equal(corpsSur('abcdef', 4), 'abc…');
  });
});
