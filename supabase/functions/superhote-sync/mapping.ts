// Conversion d'une reservation de l'API publique SuperHote V2 vers le schema bnb-pilot.
//
// Module volontairement pur : aucune dependance a Deno, a Supabase ou au reseau, pour
// qu'il soit rejouable hors ligne sur les 204 reservations connues (voir mapping.test.ts).
//
// Toutes les formules ci-dessous ont ete validees le 04/08/2026 contre l'import valide
// du 31/07/2026 (~/dev/bnb-pilot-sauvegardes/import-a-valider.json, 200 reservations) :
//   - 14 champs directs           : 200/200
//   - montant                     : 181/181 sur les confirmees
//   - montant_paye                : 181/181 sur les confirmees
//   - taxe                        : 163/181, les 18 ecarts etant exactement les taxes
//                                   perdues par SuperHote lors de la migration V1 -> V2,
//                                   restaurees cote app par AL_VALID.repriseTaxe()
//   - revenu_brut                 : 98/181, formule heritee du CSV -> recalibrage au Lot 2

export interface PriceLine {
  type: string;
  total: number;
}

export interface ReservationApi {
  id: number | string;
  rental_id: number;
  status: number;
  status_label?: string;
  platform_name: string;
  checkin: string;
  checkout: string;
  nights: number;
  guests_count: number | null;
  guest_first_name: string | null;
  guest_last_name: string | null;
  total_price: number | null;
  host_payout: number | null;
  price_details: PriceLine[] | null;
  host_fees: PriceLine[] | null;
  booked_at: string | null;
  updated_at: string;
}

export interface Reservation {
  id: string;
  plateforme: string;
  origine: string;
  date_resa: string | null;
  entree: string;
  sortie: string;
  nuits: number | null;
  nom: string;
  prenom: string;
  logement_label: string;
  logement: string | null;
  montant_paye: number | null;
  revenu_brut: number | null;
  commission: number | null;
  taxe: number | null;
  frais_menage: number | null;
  montant: number | null;
  nb_pers: number | null;
  statut: string;
  annee: number | null;
  source: string;
}

// Lignes de prix qui composent le prix des nuitees. Reprises de la table /reference,
// relevee le 04/08/2026. Un type inconnu n'est pas compte ici : il ressortira comme
// ecart au rejeu plutot que de se fondre silencieusement dans un total.
const TYPES_NUITEES = new Set([
  'night',
  'daily_price',
  'weekly_price',
  'monthly_price',
  'base_price',
  'special_offer_base_price',
  'daily_discount',
  'weekly_discount',
  'monthly_discount',
  'discount_amount',
  'reduction_percent',
  'coupon_savings',
  'airbnb_funded_discount',
]);

// La taxe de sejour arrive sous deux types selon le canal : collectee par nous en direct
// et via le site, reversee par Airbnb pour son propre canal.
const TYPES_TAXE = new Set(['city_tax', 'guest_exclusive_tax_remitted_by_airbnb']);

const TYPES_MENAGE = new Set(['cleaning_fee']);

// Correspondance des codes de statut, relevee sur /reference le 04/08/2026.
// Le mapping se fait sur le CODE NUMERIQUE, jamais sur le libelle, qui peut etre
// traduit sans preavis. Tout code absent de cette table arrete la synchro : pas de
// valeur par defaut silencieuse.
const STATUTS: Record<number, string | null> = {
  0: 'Annulée',            // CANCELED
  1: 'Confirmée',          // CONFIRMED
  5: 'Annulée',            // CANCELED_BY_TRAVELER
  7: null,                 // REQUEST_INFORMATION : demande d'information, pas une reservation
};

export class StatutInconnuError extends Error {
  code: number;
  reservationId: string;
  constructor(code: number, reservationId: string) {
    super(
      `Statut SuperHote inconnu : ${code} (reservation ${reservationId}). ` +
        `Codes connus : ${Object.keys(STATUTS).join(', ')}. ` +
        `Verifier /api/v2/public/reference avant d'etendre la table STATUTS.`,
    );
    this.name = 'StatutInconnuError';
    this.code = code;
    this.reservationId = reservationId;
  }
}

/** Arrondi au centime, sur le modele de num() dans index.html. */
export function centimes(n: number): number {
  return Math.round(n * 100) / 100;
}

function somme(lignes: PriceLine[] | null | undefined, types: Set<string>): number {
  if (!lignes || !lignes.length) return 0;
  let t = 0;
  for (const l of lignes) if (types.has(l.type)) t += Number(l.total) || 0;
  return centimes(t);
}

function sommeTout(lignes: PriceLine[] | null | undefined): number {
  if (!lignes || !lignes.length) return 0;
  let t = 0;
  for (const l of lignes) t += Number(l.total) || 0;
  return centimes(t);
}

/** Canal commercial, aligne sur origineSh() dans index.html. */
export function origineDe(plateforme: string): string {
  const p = (plateforme || '').toLowerCase();
  if (p.includes('airbnb')) return 'Airbnb';
  if (p.includes('booking')) return 'Booking';
  if (p.includes('website') || p.includes('site')) return 'Site web';
  if (p.includes('direct')) return 'Direct';
  return plateforme ? plateforme[0].toUpperCase() + plateforme.slice(1) : '';
}

/** La taxe de sejour est-elle encaissee par nous ? Vrai en direct et via le site. */
function taxeEncaisseeParHote(plateforme: string): boolean {
  const o = origineDe(plateforme);
  return o === 'Direct' || o === 'Site web';
}

/** Normalisation des libelles, identique a norm() dans index.html. */
export function normaliser(v: string): string {
  return (v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Propriete {
  nom: string;
  superhote_labels?: string[] | null;
}

/**
 * Resolution du bien depuis le libelle d'annonce, meme logique que bienOf() dans
 * index.html : comparaison en sous-chaine dans les deux sens, sans accent.
 * Retourne null si le libelle n'est pas reconnu, la modale se chargera du mappage.
 */
export function bienDe(libelle: string, proprietes: Propriete[]): string | null {
  const n = normaliser(libelle);
  if (!n) return null;
  for (const p of proprietes || []) {
    for (const lab of p.superhote_labels || []) {
      const nl = normaliser(lab);
      if (nl && (n.includes(nl) || nl.includes(n))) return p.nom;
    }
  }
  return null;
}

export interface OptionsMapping {
  /** id de logement SuperHote -> libelle d'annonce, depuis GET /rentals */
  libelles: Map<number, string>;
  /** referentiel des biens, depuis la table properties */
  proprietes: Propriete[];
}

/**
 * Convertit une reservation de l'API au schema bnb-pilot.
 * Retourne null pour les demandes d'information (statut 7), qui ne sont pas des
 * reservations et doivent rester hors des calculs.
 * Leve StatutInconnuError sur tout code de statut non repertorie.
 */
export function mapper(r: ReservationApi, opts: OptionsMapping): Reservation | null {
  const id = String(r.id);

  if (!(r.status in STATUTS)) throw new StatutInconnuError(r.status, id);
  const statut = STATUTS[r.status];
  if (statut === null) return null;

  const libelle = opts.libelles.get(r.rental_id) || '';
  const taxe = somme(r.price_details, TYPES_TAXE);
  const menage = somme(r.price_details, TYPES_MENAGE);
  const nuitees = somme(r.price_details, TYPES_NUITEES);
  // Toutes les lignes de host_fees sont des prelevements de la plateforme
  // (host_platform_commission, airbnb_host_fee). Verifie 200/200.
  const commission = sommeTout(r.host_fees);

  const entree = r.checkin || '';

  return {
    id,
    plateforme: r.platform_name || '',
    origine: origineDe(r.platform_name || ''),
    date_resa: (r.booked_at || '').slice(0, 10) || null,
    entree,
    sortie: r.checkout || '',
    nuits: r.nights ?? null,
    nom: (r.guest_last_name || '').trim(),
    prenom: (r.guest_first_name || '').trim(),
    logement_label: libelle,
    logement: bienDe(libelle, opts.proprietes),

    // Montant reellement verse a l'hote, convention V1 conservee : la taxe de sejour
    // reste dans le verse quand c'est nous qui l'encaissons (direct et site), elle en
    // est exclue quand la plateforme la collecte et la reverse (Airbnb, Booking).
    montant: centimes((r.host_payout || 0) + (taxeEncaisseeParHote(r.platform_name) ? taxe : 0)),

    // Montant paye par le voyageur, taxes comprises. Verifie 181/181.
    montant_paye: r.total_price == null ? null : centimes(r.total_price),

    // TODO Lot 2 : formule heritee du CSV, exacte a 98/181 seulement. L'API expose
    // total_price et fare_accommodation, le recalibrage est un travail de calcul, pas
    // un manque de donnee. Critere du Lot 2 : 196/200.
    revenu_brut: centimes(nuitees + menage + (origineDe(r.platform_name) === 'Airbnb' ? 0 : taxe)),

    commission,
    taxe,
    frais_menage: menage,
    nb_pers: r.guests_count ?? null,
    statut,
    annee: /^\d{4}/.test(entree) ? Number(entree.slice(0, 4)) : null,
    source: 'Superhote',
  };
}

export type StatutPending = 'en_attente' | 'valide' | 'rejete' | 'supprime';

export interface LignePending {
  statut: StatutPending;
  updated_at: string;
}

/**
 * Regle d'upsert de sh_pending, isolee pour etre testable.
 *
 *  - ligne absente                                  -> ecrire en_attente
 *  - ligne « valide » dont l'updated_at a change    -> repasse en_attente
 *  - ligne « valide » inchangee                     -> ne rien faire
 *  - ligne « rejete »                               -> ne JAMAIS rouvrir, sinon un refus
 *                                                      delibere reviendrait a chaque passage
 *  - ligne « en_attente » ou « supprime »           -> rafraichir le payload
 */
export function decisionUpsert(
  existant: LignePending | null | undefined,
  updatedAtDistant: string,
): 'ecrire' | 'ignorer' {
  if (!existant) return 'ecrire';
  if (existant.statut === 'rejete') return 'ignorer';
  if (existant.statut === 'valide') {
    const a = new Date(existant.updated_at).getTime();
    const b = new Date(updatedAtDistant).getTime();
    return Number.isNaN(a) || Number.isNaN(b) || a !== b ? 'ecrire' : 'ignorer';
  }
  return 'ecrire';
}

/** Curseur de synchro : max(updated_at) reellement ingere, moins une marge. */
export function curseur(lastUpdated: string | null, margeHeures = 48): string | null {
  if (!lastUpdated) return null;
  const t = new Date(lastUpdated).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t - margeHeures * 3600 * 1000).toISOString();
}
