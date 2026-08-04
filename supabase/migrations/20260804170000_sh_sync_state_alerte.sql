-- Horodatage de la derniere alerte envoyee, pour l'anti-repetition.
--
-- Une alerte qui se repete toutes les dix minutes finit en sourdine, et c'est le meilleur
-- moyen de rater la vraie. Une par tranche de six heures suffit. Un passage reussi remet
-- ce champ a NULL : la panne suivante alerte immediatement.

alter table public.sh_sync_state
  add column if not exists alerte_le timestamptz;

comment on column public.sh_sync_state.alerte_le is
  'Derniere alerte envoyee. Anti-repetition, remis a NULL par tout passage reussi. Voir peutAlerter() dans surveillance.ts.';
