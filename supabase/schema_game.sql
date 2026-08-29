-- =====================================================================
--  SCHAKEL — databaseschema, stap 2: het spel zelf
--  Voer dit uit in de Supabase SQL Editor NA schema.sql (stap 1).
--  Veilig om opnieuw te draaien (gebruikt if not exists / or replace).
-- =====================================================================

-- ---- extra kolommen op bestaande tabellen --------------------------
alter table games   add column if not exists phase         text;      -- clue | guess | reveal
alter table games   add column if not exists turn_number   int  not null default 0;
alter table games   add column if not exists hintgever     uuid;      -- players.id
alter table games   add column if not exists clue_word     text;
alter table games   add column if not exists clue_number   int;
alter table games   add column if not exists phase_ends_at timestamptz;
alter table games   add column if not exists words_per     int  not null default 8;

alter table players add column if not exists score           int not null default 0;
alter table players add column if not exists guesses_correct int not null default 0;
alter table players add column if not exists cleared_at       timestamptz;

-- ---- nieuwe tabellen ------------------------------------------------
create table if not exists word_pool (
  id   serial primary key,
  text text not null unique
);

create table if not exists words (
  id      uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  idx     int  not null,
  text    text not null,
  unique (game_id, idx)
);
create index if not exists words_game_idx on words(game_id);

create table if not exists secret_words (
  id        uuid primary key default gen_random_uuid(),
  game_id   uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  word_idx  int  not null,
  found     boolean not null default false,
  unique (game_id, player_id, word_idx)
);
create index if not exists secret_game_idx on secret_words(game_id);

create table if not exists guesses (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  turn_number int  not null,
  rater_id    uuid not null references players(id) on delete cascade,
  word_idx    int  not null,
  correct     boolean,
  created_at  timestamptz not null default now(),
  unique (game_id, turn_number, rater_id, word_idx)
);
create index if not exists guesses_game_idx on guesses(game_id);

-- ---- Row Level Security --------------------------------------------
alter table word_pool    enable row level security;
alter table words        enable row level security;
alter table secret_words enable row level security;
alter table guesses      enable row level security;

-- Het bord is zichtbaar voor deelnemers van dat spel.
drop policy if exists "read words" on words;
create policy "read words" on words for select to authenticated using (
  exists (select 1 from players p where p.game_id = words.game_id and p.user_id = auth.uid())
);

-- Geheime woorden: JE ZIET ALLEEN JE EIGEN. Dit is de kern van de beveiliging.
drop policy if exists "read own secrets" on secret_words;
create policy "read own secrets" on secret_words for select to authenticated using (
  exists (select 1 from players p where p.id = secret_words.player_id and p.user_id = auth.uid())
);

-- Gokken zijn zichtbaar voor deelnemers (voor de onthulling).
drop policy if exists "read guesses" on guesses;
create policy "read guesses" on guesses for select to authenticated using (
  exists (select 1 from players p where p.game_id = guesses.game_id and p.user_id = auth.uid())
);
-- (Schrijven naar words/secret_words/guesses gebeurt uitsluitend via de
--  functies hieronder, die als eigenaar draaien. word_pool heeft geen
--  leespolicy, dus niemand kan de woordenlijst rechtstreeks opvragen.)

-- ---- Realtime -------------------------------------------------------
-- Zet nieuwe tabellen op de realtime-publicatie. (games/players stonden er al.)
do $$ begin
  begin alter publication supabase_realtime add table words;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table guesses; exception when duplicate_object then null; end;
end $$;

-- =====================================================================
--  FUNCTIES (server-authoritatief, draaien als eigenaar)
-- =====================================================================

-- Start het spel: kies bord, deel geheime woorden uit, zet eerste beurt.
create or replace function start_game(p_game_id uuid, p_words_per int)
returns void language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_status text; v_count int; v_board int; v_player record; v_first uuid;
begin
  select host_id, status into v_host, v_status from games where id = p_game_id;
  if v_host is null then raise exception 'Spel niet gevonden'; end if;
  if v_host <> auth.uid() then raise exception 'Alleen de host mag starten'; end if;
  if v_status <> 'lobby' then raise exception 'Spel is al begonnen'; end if;

  select count(*) into v_count from players where game_id = p_game_id;
  if v_count < 2 then raise exception 'Minstens 2 spelers nodig'; end if;

  v_board := least(
    (select count(*) from word_pool),
    greatest(30, round(p_words_per * (3 + v_count * 0.5))::int)
  );

  delete from words        where game_id = p_game_id;
  delete from secret_words where game_id = p_game_id;
  delete from guesses      where game_id = p_game_id;

  insert into words (game_id, idx, text)
  select p_game_id, (row_number() over ()) - 1, text
  from (select text from word_pool order by random() limit v_board) w;

  for v_player in select id from players where game_id = p_game_id loop
    insert into secret_words (game_id, player_id, word_idx)
    select p_game_id, v_player.id, idx
    from words where game_id = p_game_id order by random() limit p_words_per;
  end loop;

  update players set score = 0, guesses_correct = 0, cleared_at = null
  where game_id = p_game_id;

  select id into v_first from players where game_id = p_game_id order by joined_at limit 1;

  update games set status='playing', phase='clue', turn_number=1, hintgever=v_first,
    clue_word=null, clue_number=null, phase_ends_at=null, words_per=p_words_per
  where id = p_game_id;
end; $$;

-- Hintgever geeft linkwoord + getal → start de raadfase met een timer.
create or replace function submit_clue(p_game_id uuid, p_word text, p_number int)
returns void language plpgsql security definer set search_path = public as $$
declare v_hint uuid; v_phase text; v_me uuid;
begin
  select hintgever, phase into v_hint, v_phase from games where id = p_game_id;
  select id into v_me from players where game_id = p_game_id and user_id = auth.uid();
  if v_me is null or v_me <> v_hint then raise exception 'Niet jouw beurt'; end if;
  if v_phase <> 'clue' then raise exception 'Verkeerde fase'; end if;
  if length(trim(coalesce(p_word,''))) = 0 then raise exception 'Leeg linkwoord'; end if;
  if coalesce(p_number,0) < 1 then raise exception 'Getal moet minstens 1 zijn'; end if;

  update games set clue_word=trim(p_word), clue_number=p_number,
    phase='guess', phase_ends_at = now() + interval '60 seconds'
  where id = p_game_id;
end; $$;

-- Rader dient zijn keuze in (mag tot de tijd om is opnieuw indienen).
create or replace function submit_guess(p_game_id uuid, p_word_idxs int[])
returns void language plpgsql security definer set search_path = public as $$
declare v_phase text; v_hint uuid; v_num int; v_turn int; v_me uuid;
begin
  select phase, hintgever, clue_number, turn_number
    into v_phase, v_hint, v_num, v_turn
  from games where id = p_game_id;
  select id into v_me from players where game_id = p_game_id and user_id = auth.uid();
  if v_me is null then raise exception 'Geen speler'; end if;
  if v_phase <> 'guess' then raise exception 'Niet in de raadfase'; end if;
  if v_me = v_hint then raise exception 'De hintgever raadt niet mee'; end if;
  if array_length(p_word_idxs,1) is not null and array_length(p_word_idxs,1) > v_num then
    raise exception 'Te veel woorden gekozen';
  end if;

  delete from guesses where game_id=p_game_id and turn_number=v_turn and rater_id=v_me;
  if p_word_idxs is not null then
    insert into guesses (game_id, turn_number, rater_id, word_idx)
    select p_game_id, v_turn, v_me, unnest(p_word_idxs);
  end if;
end; $$;

-- Reken de ronde af: markeer goed/fout, deel punten uit, ga naar 'reveal'.
create or replace function resolve_turn(p_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_phase text; v_hint uuid; v_turn int; r record; v_gain int := 0;
begin
  select phase, hintgever, turn_number into v_phase, v_hint, v_turn
  from games where id = p_game_id;
  if v_phase <> 'guess' then return; end if;  -- idempotent

  update guesses g set correct = exists (
    select 1 from secret_words s
    where s.game_id=p_game_id and s.player_id=v_hint and s.word_idx=g.word_idx and s.found=false
  )
  where g.game_id=p_game_id and g.turn_number=v_turn;

  update secret_words s set found=true
  where s.game_id=p_game_id and s.player_id=v_hint and s.found=false
    and s.word_idx in (
      select distinct word_idx from guesses
      where game_id=p_game_id and turn_number=v_turn and correct=true
    );

  for r in
    select rater_id, count(*) filter (where correct) as c
    from guesses where game_id=p_game_id and turn_number=v_turn
    group by rater_id
  loop
    if r.c > 0 then
      update players set score = score + (2*r.c - 1),
        guesses_correct = guesses_correct + r.c
      where id = r.rater_id;
      v_gain := v_gain + (2*r.c - 1);
    end if;
  end loop;

  update players set score = score + v_gain where id = v_hint;

  update players p set cleared_at = now()
  where p.game_id=p_game_id and p.cleared_at is null
    and exists (select 1 from secret_words s where s.player_id=p.id)
    and not exists (select 1 from secret_words s where s.player_id=p.id and s.found=false);

  update games set phase='reveal' where id = p_game_id;
end; $$;

-- Volgende beurt (of einde). Alleen de host.
create or replace function next_turn(p_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_phase text; v_turn int; v_host uuid; v_next uuid; v_all boolean;
begin
  select phase, turn_number, host_id into v_phase, v_turn, v_host
  from games where id = p_game_id;
  if v_host <> auth.uid() then raise exception 'Alleen de host'; end if;
  if v_phase <> 'reveal' then return; end if;

  select not exists (select 1 from secret_words where game_id=p_game_id and found=false)
  into v_all;

  if v_all then
    update games set status='ended', phase=null where id=p_game_id;
    return;
  end if;

  with ordered as (
    select id, (row_number() over (order by joined_at)) - 1 as pos,
           count(*) over () as n
    from players where game_id = p_game_id
  ),
  cur as (
    select pos, n from ordered
    where id = (select hintgever from games where id = p_game_id)
  )
  select o.id into v_next from ordered o, cur where o.pos = (cur.pos + 1) % cur.n;

  update games set turn_number=v_turn+1, hintgever=v_next,
    phase='clue', clue_word=null, clue_number=null, phase_ends_at=null
  where id = p_game_id;
end; $$;

-- Host stopt het spel handmatig.
create or replace function end_game(p_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_host uuid;
begin
  select host_id into v_host from games where id = p_game_id;
  if v_host <> auth.uid() then raise exception 'Alleen de host'; end if;
  update games set status='ended', phase=null where id=p_game_id;
end; $$;

grant execute on function start_game(uuid,int)      to authenticated;
grant execute on function submit_clue(uuid,text,int) to authenticated;
grant execute on function submit_guess(uuid,int[])   to authenticated;
grant execute on function resolve_turn(uuid)         to authenticated;
grant execute on function next_turn(uuid)            to authenticated;
grant execute on function end_game(uuid)             to authenticated;

-- ---- woordenlijst vullen -------------------------------------------
insert into word_pool (text) values
 ('sneeuw'),('storm'),('bal'),('weer'),('zon'),('maan'),('ster'),('zee'),('strand'),('berg'),
 ('rivier'),('bos'),('boom'),('blad'),('bloem'),('tuin'),('gras'),('steen'),('rots'),('vuur'),
 ('rook'),('ijs'),('water'),('wind'),('wolk'),('regen'),('bliksem'),('donder'),('hemel'),('aarde'),
 ('zand'),('goud'),('zilver'),('ijzer'),('koper'),('staal'),('glas'),('hout'),('papier'),('inkt'),
 ('pen'),('boek'),('brief'),('woord'),('taal'),('stem'),('lied'),('muziek'),('dans'),('feest'),
 ('ballon'),('taart'),('kaars'),('cadeau'),('klok'),('tijd'),('uur'),('dag'),('nacht'),('ochtend'),
 ('avond'),('jaar'),('lente'),('zomer'),('herfst'),('winter'),('koffie'),('thee'),('melk'),('suiker'),
 ('zout'),('peper'),('brood'),('kaas'),('boter'),('appel'),('peer'),('banaan'),('druif'),('kers'),
 ('citroen'),('tomaat'),('ui'),('knoflook'),('aardappel'),('sla'),('komkommer'),('paprika'),('vis'),('kip'),
 ('koe'),('varken'),('schaap'),('paard'),('hond'),('kat'),('muis'),('vogel'),('uil'),('zwaan'),
 ('eend'),('kikker'),('slang'),('spin'),('bij'),('vlinder'),('mier'),('haai'),('walvis'),('dolfijn'),
 ('octopus'),('krab'),('schelp'),('parel'),('anker'),('schip'),('boot'),('zeil'),('kompas'),('kaart'),
 ('schat'),('eiland'),('haven'),('brug'),('weg'),('straat'),('plein'),('huis'),('deur'),('raam'),
 ('dak'),('muur'),('trap'),('keuken'),('bed'),('stoel'),('tafel'),('lamp'),('spiegel'),('sleutel'),
 ('slot'),('koffer'),('tas'),('jas'),('schoen'),('hoed'),('bril'),('horloge'),('ring'),('kroon'),
 ('troon'),('kasteel'),('ridder'),('zwaard'),('schild'),('pijl'),('boog'),('draak'),('heks'),('tovenaar'),
 ('geest'),('schaduw'),('licht'),('kleur'),('verf'),('kwast'),('foto'),('film'),('scherm'),('knop'),
 ('draad'),('kabel'),('stroom'),('motor'),('wiel'),('auto'),('trein'),('bus'),('fiets'),('vliegtuig'),
 ('raket'),('planeet'),('komeet'),('melkweg')
on conflict (text) do nothing;
