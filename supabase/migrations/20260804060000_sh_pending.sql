-- Lot 1 de la synchronisation SuperHote V2 -> bnb-pilot.
-- Table d'attente alimentee par l'Edge Function « superhote-sync », relue par la modale
-- de validation existante (AL_VALID.openGate). Rien n'entre dans data_snapshots sans
-- validation humaine : ces deux tables sont un sas, pas une source de verite.

-- ---------------------------------------------------------------------------
-- sh_pending : une ligne par reservation SuperHote en attente d'arbitrage
-- ---------------------------------------------------------------------------
create table if not exists public.sh_pending (
  id          text        primary key,               -- identifiant SuperHote, meme cle que keyer()
  payload     jsonb       not null,                  -- reservation mappee au schema bnb-pilot
  bien        text,                                  -- resolu via properties.superhote_labels, null si libelle inconnu
  updated_at  timestamptz not null,                  -- updated_at distant, sert de curseur
  fetched_at  timestamptz not null default now(),
  statut      text        not null default 'en_attente',
  traite_le   timestamptz,
  traite_par  text,
  constraint sh_pending_statut_check
    check (statut in ('en_attente', 'valide', 'rejete', 'supprime'))
);

create index if not exists sh_pending_statut_idx on public.sh_pending (statut);
create index if not exists sh_pending_bien_idx   on public.sh_pending (bien);

comment on table  public.sh_pending is 'Sas de validation des reservations SuperHote V2 avant ecriture dans data_snapshots.';
comment on column public.sh_pending.statut is 'en_attente | valide | rejete | supprime. Une ligne rejete ne revient jamais en attente automatiquement.';

-- ---------------------------------------------------------------------------
-- sh_sync_state : curseur et journal du dernier passage
-- ---------------------------------------------------------------------------
create table if not exists public.sh_sync_state (
  source              text primary key,
  last_run_at         timestamptz,
  last_updated        timestamptz,   -- max(updated_at) REELLEMENT ingere, base du curseur
  last_full_check_at  timestamptz,   -- dernier rapprochement complet des identifiants (Lot 4)
  last_status         text,
  last_error          text
);

comment on column public.sh_sync_state.last_updated is 'max(updated_at) reellement ingere. Le curseur en retranche 48 h : une interruption longue ne perd donc rien.';

insert into public.sh_sync_state (source) values ('superhote_v2')
on conflict (source) do nothing;

-- ---------------------------------------------------------------------------
-- RLS : meme modele que data_snapshots, data_validations et properties.
-- Le depot alexandreselly-eng/ambassador-lodge est PUBLIC et sh_pending contient
-- des noms de voyageurs : la cle anon ne doit rien voir.
-- ---------------------------------------------------------------------------
alter table public.sh_pending    enable row level security;
alter table public.sh_sync_state enable row level security;

drop policy if exists sh_pending_authenticated on public.sh_pending;
create policy sh_pending_authenticated on public.sh_pending
  for all to authenticated using (true) with check (true);

drop policy if exists sh_sync_state_authenticated on public.sh_sync_state;
create policy sh_sync_state_authenticated on public.sh_sync_state
  for all to authenticated using (true) with check (true);

-- Aucune politique pour anon : la cle publiable presente en clair dans index.html
-- ne retourne donc rien sur ces deux tables. Le role service_role de l'Edge Function
-- contourne RLS par construction.

-- ---------------------------------------------------------------------------
-- Purge : les lignes arbitrees de plus de 30 jours ne servent plus a rien.
-- Les lignes « en_attente » ne sont jamais purgees, quel que soit leur age.
-- ---------------------------------------------------------------------------
create or replace function public.sh_pending_purge()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  supprimees integer;
begin
  delete from public.sh_pending
   where statut in ('valide', 'rejete', 'supprime')
     and traite_le is not null
     and traite_le < now() - interval '30 days';
  get diagnostics supprimees = row_count;
  return supprimees;
end;
$$;

comment on function public.sh_pending_purge() is 'Purge les lignes arbitrees de plus de 30 jours. A brancher sur le cron du Lot 4.';
