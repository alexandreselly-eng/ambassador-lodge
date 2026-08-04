-- Version du mapping ayant produit chaque ligne du sas.
--
-- Sans elle, la regle d'upsert ne re-proposait une ligne deja validee que si la donnee
-- DISTANTE avait bouge, jamais si notre propre calcul avait evolue. Consequence constatee
-- le 04/08/2026 : les 200 reservations validees la veille sont restees figees sur un
-- mapping perime (revenu_brut d'avant recalibrage, `paiement` absent), et aucune synchro
-- ne pouvait les rattraper. La seule issue etait une remise a l'etat « en_attente » a la main.

alter table public.sh_pending
  add column if not exists mapping_version text;

comment on column public.sh_pending.mapping_version is
  'Version du mapping ayant produit payload. Une ligne validee sous une version anterieure repasse en attente : voir VERSION_MAPPING dans mapping.ts.';

-- Reprise du retard : les lignes deja validees l'ont ete sous un mapping anterieur, sans
-- version enregistree. Les remettre en attente les fait repasser par la modale de validation
-- avec les valeurs corrigees. Rien n'est supprime, data_snapshots n'est pas touche : c'est la
-- validation humaine qui decidera d'appliquer, ou non.
--
-- Les lignes « rejete » ne sont volontairement pas reouvertes : un refus delibere se leve a
-- la main, un changement de version ne doit pas le contredire.
update public.sh_pending
   set statut = 'en_attente', traite_le = null, traite_par = null, mapping_version = null
 where statut = 'valide';

-- Curseur remis a zero pour forcer une relecture complete au prochain passage.
update public.sh_sync_state
   set last_updated = null
 where source = 'superhote_v2';
