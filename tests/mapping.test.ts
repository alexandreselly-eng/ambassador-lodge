// Rejeu du mapping SuperHote V2 sur les 204 reservations reelles du compte.
//
//   node --test tests/
//
// Les fixtures ne sont PAS dans le depot : elles contiennent des noms de voyageurs et
// « alexandreselly-eng/ambassador-lodge » est public. Elles vivent dans
// ~/dev/bnb-pilot-sauvegardes/, a cote des sauvegardes de base. Voir le README de la
// fonction pour les regenerer. Les tests qui en dependent sont ignores si elles manquent.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  bienDe,
  centimes,
  curseur,
  decisionUpsert,
  estSolde,
  mapper,
  origineDe,
  PAIEMENTS_SOLDES,
  StatutInconnuError,
  VERSION_MAPPING,
  type Propriete,
  type ReservationApi,
} from '../supabase/functions/superhote-sync/mapping.ts';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = process.env.BNB_FIXTURES || join(homedir(), 'dev', 'bnb-pilot-sauvegardes');

const F_API = join(FIXTURES, 'fixture-api-reservations_2026-08-04.json');
const F_RENTALS = join(FIXTURES, 'fixture-api-rentals_2026-08-04.json');
const F_REF = join(FIXTURES, 'import-a-valider.json');

const fixturesPresentes = [F_API, F_RENTALS, F_REF].every(existsSync);
const lire = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

// Referentiel des biens, tel qu'il est en base (verifie le 31/07 : 3 biens).
const PROPRIETES: Propriete[] = [
  { nom: 'Ambassador', superhote_labels: ['- Villa Ambassador  Piscine Spa -'] },
  { nom: 'Lodge', superhote_labels: ['- Lodge Spa & Nature à La Chaloupe -'] },
  { nom: 'Villa Métis', superhote_labels: ['Villa Métis :  4 étoiles  spa vue montagne  8 pers'] },
];

// ---------------------------------------------------------------------------
// Fonctions pures : aucune fixture requise
// ---------------------------------------------------------------------------

describe('fonctions pures', () => {
  test('origineDe couvre les quatre canaux', () => {
    assert.equal(origineDe('Airbnb.com'), 'Airbnb');
    assert.equal(origineDe('Booking.com'), 'Booking');
    assert.equal(origineDe('Website'), 'Site web');
    assert.equal(origineDe('Direct'), 'Direct');
    assert.equal(origineDe(''), '');
  });

  test('bienDe reconnait le libelle malgre accents et doubles espaces', () => {
    assert.equal(bienDe('Villa Métis :  4 étoiles  spa vue montagne  8 pers', PROPRIETES), 'Villa Métis');
    assert.equal(bienDe('- Villa Ambassador  Piscine Spa -', PROPRIETES), 'Ambassador');
    assert.equal(bienDe('Gite inconnu', PROPRIETES), null, 'un libelle inconnu doit rester a mapper');
    assert.equal(bienDe('', PROPRIETES), null);
  });

  test('centimes arrondit au centime', () => {
    assert.equal(centimes(1130.4999999), 1130.5);
    assert.equal(centimes(0.1 + 0.2), 0.3);
  });

  test('curseur retranche 48 h et tolere un etat vide', () => {
    assert.equal(curseur('2026-08-04T10:00:00.000Z'), '2026-08-02T10:00:00+00:00');
    assert.equal(curseur(null), null, 'sans curseur, la synchro doit lire tout l historique');
    assert.equal(curseur('pas une date'), null);
  });

  // SuperHote valide updated_since contre le motif PHP « Y-m-d\TH:i:sP » et repond 422
  // sinon : ni millisecondes, ni « Z ». Regression constatee en production le 04/08/2026.
  test('curseur respecte le format attendu par SuperHote', () => {
    const attendu = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/;
    for (const entree of [
      '2026-08-04T06:00:25+00:00',   // format renvoye par l API
      '2026-08-04T10:00:00.000Z',    // format ISO avec millisecondes
      '2026-08-04T10:00:00Z',
      '2026-08-04T12:00:00+02:00',   // avec decalage
    ]) {
      const c = curseur(entree);
      assert.match(c!, attendu, `format invalide pour ${entree} : ${c}`);
      assert.ok(!c!.includes('.'), 'aucune milliseconde');
      assert.ok(!c!.endsWith('Z'), 'decalage explicite, pas de Z');
    }
  });

  const V = VERSION_MAPPING;
  test('regle d upsert : un rejet delibere ne revient jamais tout seul', () => {
    assert.equal(decisionUpsert(null, '2026-08-04T10:00:00Z'), 'ecrire');
    assert.equal(
      decisionUpsert({ statut: 'rejete', updated_at: '2026-01-01T00:00:00Z', mapping_version: V }, '2026-08-04T10:00:00Z'),
      'ignorer',
    );
    assert.equal(
      decisionUpsert({ statut: 'valide', updated_at: '2026-08-04T10:00:00Z', mapping_version: V }, '2026-08-04T10:00:00Z'),
      'ignorer',
      'une ligne validee et inchangee ne doit pas repasser en attente',
    );
    assert.equal(
      decisionUpsert({ statut: 'valide', updated_at: '2026-01-01T00:00:00Z', mapping_version: V }, '2026-08-04T10:00:00Z'),
      'ecrire',
      'une ligne validee dont la source a bouge doit etre rearbitree',
    );
    assert.equal(
      decisionUpsert({ statut: 'en_attente', updated_at: '2026-01-01T00:00:00Z', mapping_version: V }, '2026-08-04T10:00:00Z'),
      'ecrire',
    );
  });

  // Le defaut du 04/08/2026 : une correction de formule restait invisible sur tout
  // l'historique deja arbitre, la regle ne regardant que la donnee distante.
  test('une ligne validee sous un mapping perime est re-proposee', () => {
    const t = '2026-08-04T10:00:00Z';
    assert.equal(
      decisionUpsert({ statut: 'valide', updated_at: t, mapping_version: '2026-08-04.1' }, t),
      'ecrire',
      'notre calcul a change : la valeur validee est perimee',
    );
    assert.equal(
      decisionUpsert({ statut: 'valide', updated_at: t, mapping_version: null }, t),
      'ecrire',
      'ligne anterieure au versionnement',
    );
    assert.equal(
      decisionUpsert({ statut: 'valide', updated_at: t, mapping_version: V }, t),
      'ignorer',
      'meme version et donnee inchangee : rien a refaire',
    );
    assert.equal(
      decisionUpsert({ statut: 'rejete', updated_at: t, mapping_version: '2026-08-04.1' }, t),
      'ignorer',
      'un changement de version ne contredit pas un refus delibere',
    );
  });

  test('estSolde ne suppose jamais un encaissement', () => {
    for (const p of ['MANAGED_BY_PLATFORM', 'PAID', 'PAID_MANUALLY']) assert.ok(estSolde(p), `${p} vaut solde`);
    for (const p of ['UNPAID', 'PARTIALLY_PAID', 'CANCELED', 'CODE_INEDIT', '', null, undefined]) {
      assert.equal(estSolde(p as any), false, `${p} ne doit rien solder`);
    }
  });

  // La liste est dupliquee : mapping.ts la porte pour la synchro, index.html pour compute().
  // Une derive entre les deux ferait diverger le reste a payer selon le chemin. Ce test
  // remplace un commentaire « penser a mettre a jour les deux ».
  test('la liste des paiements soldes est identique dans index.html', () => {
    const html = readFileSync(join(RACINE, 'index.html'), 'utf8');
    const m = html.match(/const PAIEMENTS_SOLDES=\[([^\]]+)\]/);
    assert.ok(m, 'PAIEMENTS_SOLDES introuvable dans index.html');
    const cote = m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    assert.deepEqual(cote.sort(), [...PAIEMENTS_SOLDES].sort());
  });

  test('un statut inconnu arrete la synchro au lieu de deviner', () => {
    const base = {
      id: 1, rental_id: 1, platform_name: 'Direct', checkin: '2026-01-01', checkout: '2026-01-03',
      nights: 2, guests_count: 2, guest_first_name: 'A', guest_last_name: 'B', total_price: 100,
      host_payout: 100, price_details: [], host_fees: [], booked_at: null, updated_at: '2026-01-01T00:00:00Z',
    };
    const opts = { libelles: new Map<number, string>(), proprietes: PROPRIETES };
    for (const code of [2, 3, 4, 6, 42]) {
      assert.throws(
        () => mapper({ ...base, status: code } as ReservationApi, opts),
        StatutInconnuError,
        `le code ${code} doit lever une erreur explicite`,
      );
    }
    assert.equal(mapper({ ...base, status: 7 } as ReservationApi, opts), null, 'une demande d information n est pas une reservation');
    assert.equal(mapper({ ...base, status: 1 } as ReservationApi, opts)?.statut, 'Confirmée');
    assert.equal(mapper({ ...base, status: 0 } as ReservationApi, opts)?.statut, 'Annulée');
    assert.equal(mapper({ ...base, status: 5 } as ReservationApi, opts)?.statut, 'Annulée');
  });
});

// ---------------------------------------------------------------------------
// Rejeu sur les 204 reservations reelles
// ---------------------------------------------------------------------------

describe('rejeu sur les 204 reservations connues', { skip: fixturesPresentes ? false : `fixtures absentes de ${FIXTURES}` }, () => {
  let mappees: Map<string, any>;
  let reference: Map<string, any>;
  let brutes: ReservationApi[];
  let ignorees = 0;

  before(() => {
    brutes = lire(F_API).reservations;
    const rentals = lire(F_RENTALS).rentals;
    const libelles = new Map<number, string>(rentals.map((r: any) => [r.id, r.name]));
    reference = new Map(lire(F_REF).map((r: any) => [r.id, r]));

    mappees = new Map();
    for (const r of brutes) {
      const m = mapper(r, { libelles, proprietes: PROPRIETES });
      if (m === null) { ignorees++; continue; }
      mappees.set(m.id, m);
    }
  });

  test('le jeu de reference est bien celui attendu', () => {
    assert.equal(brutes.length, 204, '204 reservations cote API');
    assert.equal(reference.size, 200, '200 lignes dans l import valide du 31/07');
    assert.equal(ignorees, 4, 'les 4 demandes d information sont ecartees, pas comptees comme reservations');
    assert.equal(mappees.size, 200);
  });

  // Les 14 champs que l API livre tels quels. Aucun ecart tolere.
  const CHAMPS_DIRECTS = [
    'plateforme', 'origine', 'date_resa', 'entree', 'sortie', 'nuits', 'nom', 'prenom',
    'logement_label', 'logement', 'commission', 'frais_menage', 'nb_pers', 'statut', 'annee',
  ];

  for (const champ of CHAMPS_DIRECTS) {
    test(`${champ} : identique a la reference sur les 200`, () => {
      const ecarts = [];
      for (const [id, m] of mappees) {
        const ref = reference.get(id);
        if (!ref) continue;
        const a = m[champ], b = ref[champ];
        const egal = typeof a === 'number' || typeof b === 'number'
          ? Math.abs((a ?? 0) - (b ?? 0)) < 0.011
          : (a ?? '') === (b ?? '');
        if (!egal) ecarts.push({ id, attendu: b, obtenu: a });
      }
      assert.deepEqual(ecarts, [], `${ecarts.length} ecart(s) sur ${champ}`);
    });
  }

  test('montant : 181/181 sur les confirmees, convention V1 conservee', () => {
    const ecarts = [];
    for (const [id, m] of mappees) {
      if (m.statut !== 'Confirmée') continue;
      const ref = reference.get(id);
      if (!ref) continue;
      if (Math.abs((m.montant ?? 0) - (ref.montant ?? 0)) >= 0.011) ecarts.push({ id, attendu: ref.montant, obtenu: m.montant });
    }
    assert.deepEqual(ecarts, []);
    assert.equal([...mappees.values()].filter((m) => m.statut === 'Confirmée').length, 181);
  });

  // Lot 2. La reference vient du CSV, qui livrait 0 sur Booking faute de colonne
  // « night price » renseignee. L API corrige ce defaut : les seuls ecarts admis sont
  // ceux ou la reference vaut 0 alors que le sejour a bien un revenu.
  test('revenu_brut : exact partout ou la reference est fiable', () => {
    const ecarts = [];
    const refZero = [];
    for (const [id, m] of mappees) {
      if (m.statut !== 'Confirmée') continue;
      const ref = reference.get(id);
      if (!ref) continue;
      if (Math.abs((m.revenu_brut ?? 0) - (ref.revenu_brut ?? 0)) < 0.011) continue;
      if ((ref.revenu_brut ?? 0) === 0 && (m.revenu_brut ?? 0) > 0) refZero.push({ id, canal: m.origine, obtenu: m.revenu_brut });
      else ecarts.push({ id, canal: m.origine, attendu: ref.revenu_brut, obtenu: m.revenu_brut });
    }
    assert.deepEqual(ecarts, [], 'aucun ecart autre que les zeros du CSV');
    assert.equal(refZero.length, 9);
    assert.deepEqual([...new Set(refZero.map((r) => r.canal))], ['Booking'], 'le defaut du CSV ne touchait que Booking');
  });

  test('montant_paye : 181/181 sur les confirmees', () => {
    const ecarts = [];
    for (const [id, m] of mappees) {
      if (m.statut !== 'Confirmée') continue;
      const ref = reference.get(id);
      if (!ref) continue;
      if (Math.abs((m.montant_paye ?? 0) - (ref.montant_paye ?? 0)) >= 0.011) ecarts.push({ id, attendu: ref.montant_paye, obtenu: m.montant_paye });
    }
    assert.deepEqual(ecarts, []);
  });

  test('total du montant verse confirme : 264 521 €', () => {
    const total = [...mappees.values()]
      .filter((m) => m.statut === 'Confirmée')
      .reduce((s, m) => s + (m.montant ?? 0), 0);
    assert.equal(Math.round(total), 264521);
  });

  test('taxe : les seuls ecarts sont les 18 taxes perdues par la migration V1 vers V2', () => {
    const perdues = [];
    const autres = [];
    for (const [id, m] of mappees) {
      if (m.statut !== 'Confirmée') continue;
      const ref = reference.get(id);
      if (!ref) continue;
      if (Math.abs((m.taxe ?? 0) - (ref.taxe ?? 0)) < 0.011) continue;
      // Un ecart legitime : la reference porte une taxe, l API renvoie 0.
      if ((ref.taxe ?? 0) > 0 && (m.taxe ?? 0) === 0) perdues.push({ id, taxe: ref.taxe, canal: m.origine });
      else autres.push({ id, attendu: ref.taxe, obtenu: m.taxe });
    }
    assert.deepEqual(autres, [], 'aucun ecart de taxe autre que les pertes de migration');
    assert.equal(perdues.length, 18);
    assert.equal(Math.round(perdues.reduce((s, p) => s + p.taxe, 0)), 1368, '1 368 € de taxe perdus');
    assert.deepEqual(
      [...new Set(perdues.map((p) => p.canal))].sort(),
      ['Direct', 'Site web'],
      'les pertes ne concernent que les canaux ou nous encaissons la taxe',
    );
  });

  // L'etat de paiement est ce que le CSV ne portait pas. Sans lui, le reste a payer suppose
  // qu'aucun euro n'a ete encaisse et affiche un solde sur des sejours entierement regles.
  test('paiement : etat repris tel quel, et repartition connue', () => {
    const par: Record<string, number> = {};
    let solde = 0, ouvert = 0, inconnu = 0;
    for (const m of mappees.values()) {
      if (m.statut !== 'Confirmée') continue;
      const p = m.paiement || '(absent)';
      par[p] = (par[p] || 0) + 1;
      if (estSolde(m.paiement)) solde++;
      else if (p === 'PARTIALLY_PAID' || p === 'UNPAID') ouvert++;
      else inconnu++;
    }
    assert.equal(solde, 141, 'sejours regles : Airbnb gere par la plateforme, payes, payes manuellement');
    assert.equal(ouvert, 39, 'soldes reellement ouverts : impayes et partiellement payes');
    assert.equal(inconnu, 1, 'une confirmee porte un paiement CANCELED : jamais supposee reglee');
    assert.equal(par.MANAGED_BY_PLATFORM, 58);
    assert.equal(par.PAID, 80);
  });

  test('aucun libelle de logement non reconnu', () => {
    const inconnus = [...mappees.values()].filter((m) => !m.logement);
    assert.deepEqual(inconnus, []);
  });
});

// ---------------------------------------------------------------------------
// Enchainement avec repriseTaxe() : le point de conception a ne pas rater.
// L upsert de la synchro ecrit ces 18 lignes avec une taxe a zero ; c est
// AL_VALID.repriseTaxe(), cote app, qui restaure la valeur deja validee.
// ---------------------------------------------------------------------------

describe('reprise de la taxe par AL_VALID', { skip: fixturesPresentes ? false : 'fixtures absentes' }, () => {
  test('les 18 lignes a taxe perdue ressortent avec leur taxe', () => {
    const html = readFileSync(join(RACINE, 'index.html'), 'utf8');
    const debut = html.indexOf('const AL_VALID = (function(){');
    const fin = html.indexOf('function renderValidation()', debut);
    assert.ok(debut > 0 && fin > debut, 'bloc AL_VALID introuvable dans index.html');

    // Le bloc est evalue tel quel, sans DOM : seules des definitions s executent.
    const bac: any = { module: { exports: {} }, console };
    vm.createContext(bac);
    vm.runInContext(html.slice(debut, fin) + '\nmodule.exports = AL_VALID;', bac);
    const AL_VALID = bac.module.exports;
    assert.equal(typeof AL_VALID.repriseTaxe, 'function');

    const rentals = lire(F_RENTALS).rentals;
    const libelles = new Map<number, string>(rentals.map((r: any) => [r.id, r.name]));
    const memoire = lire(F_REF); // ce qui est deja valide en base

    const entrantes = [];
    for (const r of lire(F_API).reservations) {
      const m = mapper(r, { libelles, proprietes: PROPRIETES });
      if (m) entrantes.push(m);
    }

    const aZeroAvant = entrantes.filter((m) => {
      const ref = memoire.find((x: any) => x.id === m.id);
      return ref && (ref.taxe ?? 0) > 0 && (m.taxe ?? 0) === 0;
    }).length;
    assert.equal(aZeroAvant, 20, '20 lignes arrivent a zero (18 confirmees + 2 annulees)');

    const reprises = AL_VALID.repriseTaxe(entrantes, memoire);
    assert.equal(reprises, 20, 'les 20 doivent etre restaurees');

    const restantes = entrantes.filter((m) => {
      const ref = memoire.find((x: any) => x.id === m.id);
      return ref && (ref.taxe ?? 0) > 0 && (m.taxe ?? 0) === 0;
    });
    assert.deepEqual(restantes, [], 'plus aucune taxe ecrasee par zero apres reprise');
  });
});
