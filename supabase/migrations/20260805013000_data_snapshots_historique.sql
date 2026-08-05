-- Sauvegarde des jeux de donnees remplaces, pour rendre une validation reversible.
--
-- data_snapshots est ecrase integralement a chaque validation : `upsert({ rows: sub })`
-- remplace la totalite des lignes du bien. Il n'existait donc AUCUN retour arriere.
-- data_validations garde un resume et jusqu'a 500 lignes de detail, pas les donnees.
--
-- Le 05/08/2026, la modale a propose de supprimer 75 reservations a cause d'un jeu partiel.
-- L'erreur a ete vue a temps. Si elle avait ete validee, rien n'aurait permis de revenir en
-- arriere : la sauvegarde la plus recente datait du 31/07, prise a la main.

create table if not exists public.data_snapshots_historique (
  id           bigserial primary key,
  source       text        not null,
  bien         text        not null,
  version      text,                       -- version du jeu REMPLACE
  row_count    integer,
  rows         jsonb       not null,       -- le jeu remplace, tel quel
  file_label   text,
  remplace_le  timestamptz not null default now(),
  remplace_par text                        -- e-mail de l'auteur de la validation
);

create index if not exists dsh_source_bien_idx on public.data_snapshots_historique (source, bien, remplace_le desc);

comment on table public.data_snapshots_historique is
  'Jeux de donnees remplaces par une validation. Filet de securite : data_snapshots est ecrase integralement.';

alter table public.data_snapshots_historique enable row level security;

drop policy if exists dsh_authenticated on public.data_snapshots_historique;
create policy dsh_authenticated on public.data_snapshots_historique
  for all to authenticated using (true) with check (true);

-- Aucune politique anon : la table porte des noms de voyageurs et le depot est public.

-- ---------------------------------------------------------------------------
-- Restauration, a lancer a la main apres avoir verifie ce qu'on restaure :
--
--   select id, bien, row_count, remplace_le, remplace_par
--     from public.data_snapshots_historique
--    where source = 'superhote_csv' and bien = 'Ambassador'
--    order by remplace_le desc limit 5;
--
--   update public.data_snapshots d
--      set rows = h.rows, row_count = h.row_count, version = h.version,
--          updated_at = now(), file_label = 'restauration ' || h.id
--     from public.data_snapshots_historique h
--    where h.id = <ID_CHOISI> and d.source = h.source and d.bien = h.bien;
--
-- La restauration ne supprime pas l'entree d'historique : on peut revenir sur ses pas.
-- ---------------------------------------------------------------------------
