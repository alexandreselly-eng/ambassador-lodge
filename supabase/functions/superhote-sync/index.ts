// Edge Function « superhote-sync » — Lot 1 du plan de synchronisation SuperHote V2.
//
// Lit l'API publique SuperHote de facon incrementale et depose le resultat dans la table
// d'attente sh_pending. N'ecrit JAMAIS dans data_snapshots : la validation humaine par
// AL_VALID.openGate() reste le seul chemin vers les donnees de production (Lot 3).
//
// Declenchement : cron quotidien (Lot 4) ou bouton « synchroniser maintenant » (Lot 3).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  curseur,
  decisionUpsert,
  mapper,
  StatutInconnuError,
  type LignePending,
  type Propriete,
  type ReservationApi,
} from './mapping.ts';

const API_BASE = 'https://connect.superhote.com/api/v2/public';
const SOURCE = 'superhote_v2';
const PAR_PAGE = 100;
const MARGE_HEURES = 48;
const MAX_PAGES = 100; // garde-fou : 10 000 reservations, tres au-dela du volume reel

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Appel API avec back-off exponentiel.
 * La limite de debit de SuperHote n'est pas documentee (8 appels d'affilee sans 429 le
 * 31/07 ne prouvent rien), donc on implemente le back-off par defaut plutot que de
 * supposer qu'il n'y en a pas. Retry-After est respecte quand il est fourni.
 */
async function appelApi(chemin: string, token: string, essais = 5): Promise<any> {
  let attente = 1000;
  for (let i = 1; i <= essais; i++) {
    const rep = await fetch(`${API_BASE}${chemin}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

    if (rep.status === 429 || rep.status >= 500) {
      if (i === essais) throw new Error(`SuperHote ${rep.status} apres ${essais} tentatives sur ${chemin}`);
      const entete = rep.headers.get('Retry-After');
      const delai = entete ? Number(entete) * 1000 : attente;
      console.warn(`SuperHote ${rep.status} sur ${chemin}, nouvelle tentative dans ${delai} ms`);
      await dormir(delai);
      attente *= 2;
      continue;
    }

    if (rep.status === 401 || rep.status === 403) {
      // Le token expire le 27/06/2027. Message explicite pour que l'alerte du Lot 4 soit lisible.
      throw new Error(
        `SuperHote ${rep.status} : token refuse sur ${chemin}. Verifier SUPERHOTE_TOKEN ` +
          `(cle « bnb-pilot sync », lecture reservations + hebergements, expire le 27/06/2027).`,
      );
    }

    if (!rep.ok) throw new Error(`SuperHote ${rep.status} sur ${chemin} : ${(await rep.text()).slice(0, 300)}`);

    const data = await rep.json();
    if (data && data.success === false) throw new Error(`SuperHote a repondu success=false sur ${chemin} : ${data.message}`);
    return data;
  }
  throw new Error(`Echec inattendu sur ${chemin}`);
}

/** GET /reservations pagine, filtre par updated_since quand un curseur existe. */
async function lireReservations(token: string, depuis: string | null): Promise<ReservationApi[]> {
  const toutes: ReservationApi[] = [];
  let page = 1;
  let dernierePage = 1;

  do {
    const q = new URLSearchParams({ per_page: String(PAR_PAGE), page: String(page) });
    if (depuis) q.set('updated_since', depuis);

    const data = await appelApi(`/reservations?${q}`, token);
    const res = data?.result?.reservations ?? [];
    const meta = data?.result?.meta ?? {};
    toutes.push(...res);
    dernierePage = Number(meta.last_page) || 1;

    if (page === 1) console.log(`SuperHote : ${meta.total ?? res.length} reservations, ${dernierePage} page(s)`);
    page++;
  } while (page <= dernierePage && page <= MAX_PAGES);

  if (page > MAX_PAGES) console.warn(`Garde-fou : lecture arretee a ${MAX_PAGES} pages.`);
  return toutes;
}

/**
 * Identite de l'appelant. La fonction est exposee sans verification de plateforme
 * (verify_jwt = false) pour que le cron puisse l'appeler, donc le controle est fait ici :
 * soit la cle de service (cron), soit un utilisateur authentifie (bouton de l'app).
 * Sans cela, n'importe qui pourrait declencher la synchro et consommer le quota API.
 */
async function verifierAppelant(req: Request, supabaseUrl: string, anonKey: string, serviceKey: string) {
  const entete = req.headers.get('Authorization') || '';
  const jeton = entete.replace(/^Bearer\s+/i, '').trim();
  if (!jeton) return { ok: false, motif: 'Authentification requise.' };

  // 1. Chemin rapide : la cle de service injectee par la plateforme, sans appel reseau.
  if (serviceKey && jeton === serviceKey) return { ok: true, appelant: 'cron' };

  // 2. Utilisateur authentifie de l'application (bouton « synchroniser maintenant »).
  const clientUtilisateur = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jeton}` } },
  });
  const { data } = await clientUtilisateur.auth.getUser();
  if (data?.user) return { ok: true, appelant: data.user.email || data.user.id };

  // 3. Autre cle de service. On teste le PRIVILEGE reel plutot que de comparer a une
  //    variable d'environnement : le nom de celle-ci varie selon que le projet utilise
  //    les cles historiques (SUPABASE_SERVICE_ROLE_KEY) ou les nouvelles (sb_secret_).
  //    listUsers est reserve au role de service : une cle publiable echoue ici.
  try {
    const clientAdmin = createClient(supabaseUrl, jeton);
    const { error } = await clientAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (!error) return { ok: true, appelant: 'cron' };
  } catch (_) {
    // on retombe sur le refus ci-dessous
  }

  return { ok: false, motif: 'Jeton non autorise : ni utilisateur connecte, ni cle de service.' };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const TOKEN = Deno.env.get('SUPERHOTE_TOKEN');

  if (!TOKEN) return json({ erreur: 'Secret SUPERHOTE_TOKEN absent.' }, 500);

  const auth = await verifierAppelant(req, SUPABASE_URL, ANON_KEY, SERVICE_KEY);
  if (!auth.ok) return json({ erreur: auth.motif }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const debut = new Date().toISOString();

  // Lu avant le try pour rester disponible dans le chemin d'erreur : l'upsert remplace
  // la ligne entiere, un champ omis serait remis a NULL et le curseur serait perdu.
  const { data: etat } = await db.from('sh_sync_state').select('*').eq('source', SOURCE).maybeSingle();

  try {
    // 1. Curseur : max(updated_at) REELLEMENT ingere, moins 48 h. Calculer le curseur
    //    sur la donnee ingeree et non sur l'heure du dernier passage rend une longue
    //    interruption (projet Supabase mis en pause) sans consequence.
    const depuis = curseur(etat?.last_updated ?? null, MARGE_HEURES);
    console.log(depuis ? `Synchro incrementale depuis ${depuis}` : 'Premiere synchro : lecture complete');

    // 2. Referentiels : un seul appel chacun, pas un par reservation.
    const rentals = (await appelApi('/rentals', TOKEN))?.result?.rentals ?? [];
    const libelles = new Map<number, string>(rentals.map((r: any) => [r.id, r.name]));

    const { data: props, error: errProps } = await db.from('properties').select('nom, superhote_labels');
    if (errProps) throw errProps;
    const proprietes = (props ?? []) as Propriete[];

    // 3. Lecture paginee.
    const brutes = await lireReservations(TOKEN, depuis);

    // 4. Mapping. Un statut inconnu arrete la synchro : mieux vaut ne rien ecrire que
    //    d'ecrire une valeur devinee.
    const mappees = [];
    let demandesInfo = 0;
    for (const r of brutes) {
      const m = mapper(r, { libelles, proprietes });
      if (m === null) { demandesInfo++; continue; }
      mappees.push({ reservation: m, updated_at: r.updated_at });
    }

    // 5. Application de la regle d'upsert, ligne par ligne.
    const ids = mappees.map((m) => m.reservation.id);
    const existantes = new Map<string, LignePending>();
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await db
        .from('sh_pending')
        .select('id, statut, updated_at')
        .in('id', ids.slice(i, i + 500));
      if (error) throw error;
      for (const l of data ?? []) existantes.set(l.id, l as LignePending);
    }

    const aEcrire = [];
    let ignorees = 0;
    for (const m of mappees) {
      if (decisionUpsert(existantes.get(m.reservation.id), m.updated_at) === 'ignorer') { ignorees++; continue; }
      aEcrire.push({
        id: m.reservation.id,
        payload: m.reservation,
        bien: m.reservation.logement,
        updated_at: m.updated_at,
        fetched_at: debut,
        statut: 'en_attente',
        traite_le: null,
        traite_par: null,
      });
    }

    for (let i = 0; i < aEcrire.length; i += 500) {
      const { error } = await db.from('sh_pending').upsert(aEcrire.slice(i, i + 500), { onConflict: 'id' });
      if (error) throw error;
    }

    // 6. Curseur avance sur le max(updated_at) reellement ecrit, jamais au-dela.
    const maxIngere = aEcrire.reduce<string | null>(
      (max, l) => (max === null || l.updated_at > max ? l.updated_at : max),
      null,
    );
    const nouveauCurseur = maxIngere && (!etat?.last_updated || maxIngere > etat.last_updated)
      ? maxIngere
      : etat?.last_updated ?? null;

    await db.from('sh_sync_state').upsert({
      source: SOURCE,
      last_run_at: debut,
      last_updated: nouveauCurseur,
      last_full_check_at: etat?.last_full_check_at ?? null,
      last_status: 'ok',
      last_error: null,
    }, { onConflict: 'source' });

    const resume = {
      appelant: auth.appelant,
      depuis,
      lues: brutes.length,
      demandes_information_ignorees: demandesInfo,
      deja_arbitrees_ignorees: ignorees,
      en_attente_ecrites: aEcrire.length,
      libelles_non_reconnus: aEcrire.filter((l) => !l.bien).length,
      curseur_apres: nouveauCurseur,
    };
    console.log('Synchro terminee', resume);
    return json(resume);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const statutInconnu = e instanceof StatutInconnuError;
    console.error('Synchro en echec :', message);

    // Le curseur n'est PAS avance en cas d'echec, mais il est reecrit a l'identique :
    // la prochaine execution rejouera exactement la meme fenetre. L'upsert par
    // identifiant rend l'operation idempotente.
    await db.from('sh_sync_state').upsert({
      source: SOURCE,
      last_run_at: debut,
      last_updated: etat?.last_updated ?? null,
      last_full_check_at: etat?.last_full_check_at ?? null,
      last_status: statutInconnu ? 'statut_inconnu' : 'erreur',
      last_error: message.slice(0, 1000),
    }, { onConflict: 'source' });

    return json({ erreur: message }, 500);
  }
});
