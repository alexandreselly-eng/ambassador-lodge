-- Garde-fou d'effacement, au niveau de la BASE et non du navigateur.
--
-- SUPPRESSION_MASSIVE() vit dans index.html : il protege contre l'accident constate le
-- 05/08/2026, un appelant qui transmet un jeu partiel. Il ne protege pas contre un autre
-- client, un script, ou un appel direct a l'API avec une cle de service.
--
-- Ce declencheur est le dernier rempart. Il ignore qui ecrit et par quel chemin.
--
-- Repartition volontaire des roles :
--   index.html  arrete l'ACCIDENT  : 5 lignes ou 10 %, avec confirmation possible
--   la base     arrete la CATASTROPHE : plus de la moitie du bien, sans confirmation possible
--                                       depuis l'application
--
-- Les deux seuils sont differents a dessein. Si la base appliquait le seuil de l'application,
-- toute suppression legitime confirmee a l'ecran echouerait sur une erreur SQL incomprehensible.

create or replace function public.refuser_effacement_massif()
returns trigger
language plpgsql
as $$
declare
  avant integer;
  apres integer;
begin
  -- Echappatoire deliberee, reservee a une session SQL d'administration :
  --   set local app.effacement_autorise = 'oui';
  -- L'application ne peut pas la poser : PostgREST n'expose pas SET LOCAL au client.
  -- Un effacement massif exige donc une intervention consciente, hors interface.
  if coalesce(current_setting('app.effacement_autorise', true), '') = 'oui' then
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'Refus : suppression de la memoire « % / % ». Poser app.effacement_autorise si c''est voulu.',
      old.source, old.bien
      using errcode = 'check_violation';
  end if;

  avant := coalesce(jsonb_array_length(old.rows), 0);
  apres := coalesce(jsonb_array_length(new.rows), 0);

  -- Seuil de catastrophe : perdre plus de la moitie d'un bien deja consequent.
  -- 73 lignes effacees sur 75, le cas du 05/08/2026, tombe ici. Les 19 annulations
  -- retirees de 200 lignes le 31/07, un cas legitime, passent sans encombre.
  if avant >= 10 and apres <= avant / 2 then
    raise exception
      'Refus : « % / % » passerait de % a % lignes. Plus de la moitie du bien serait effacee. Poser app.effacement_autorise si c''est voulu.',
      new.source, new.bien, avant, apres
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.refuser_effacement_massif() is
  'Dernier rempart contre l''effacement d''une memoire validee, quel que soit le client. Voir SUPPRESSION_MASSIVE() dans index.html pour le garde-fou applicatif.';

drop trigger if exists garde_fou_effacement on public.data_snapshots;
create trigger garde_fou_effacement
  before update or delete on public.data_snapshots
  for each row execute function public.refuser_effacement_massif();
