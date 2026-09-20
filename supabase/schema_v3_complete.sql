-- =====================================================================
--  SCHAKEL — COMPLEET databaseschema (versie 3)
--  Zet ALLES in één keer op: lobby, spel, zwart woord per speler,
--  doorgestreepte woorden, statistieken en bonussen.
--  Plak dit in de Supabase SQL Editor en klik Run.
--  Veilig om opnieuw te draaien; werkt op een leeg of bestaand project.
--
--  Vergeet niet: Authentication -> Sign In / Providers -> Anonymous AAN.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. TABELLEN
-- ---------------------------------------------------------------------
create table if not exists games (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  host_id       uuid not null,
  status        text not null default 'lobby',
  created_at    timestamptz not null default now()
);

create table if not exists players (
  id        uuid primary key default gen_random_uuid(),
  game_id   uuid not null references games(id) on delete cascade,
  user_id   uuid not null,
  name      text not null,
  color     text not null,
  joined_at timestamptz not null default now(),
  unique (game_id, user_id)
);
create index if not exists players_game_idx on players(game_id);

-- extra kolommen (ook voor bestaande projecten)
alter table games add column if not exists phase           text;
alter table games add column if not exists turn_number     int not null default 0;
alter table games add column if not exists hintgever       uuid;
alter table games add column if not exists clue_word       text;
alter table games add column if not exists clue_number     int;
alter table games add column if not exists phase_ends_at   timestamptz;
alter table games add column if not exists words_per       int not null default 8;
alter table games add column if not exists black_word_idx  int;
alter table games add column if not exists hint_found_idxs int[] not null default '{}';

alter table players add column if not exists score           int not null default 0;
alter table players add column if not exists guesses_correct int not null default 0;
alter table players add column if not exists cleared_at      timestamptz;
alter table players add column if not exists words_left      int not null default 0;
alter table players add column if not exists best_combo_hint int not null default 0;
alter table players add column if not exists best_combo_rate int not null default 0;

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
alter table secret_words add column if not exists is_black boolean not null default false;

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

-- ---------------------------------------------------------------------
--  2. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table games        enable row level security;
alter table players      enable row level security;
alter table word_pool    enable row level security;
alter table words        enable row level security;
alter table secret_words enable row level security;
alter table guesses      enable row level security;

drop policy if exists "read games"        on games;
drop policy if exists "create games"      on games;
drop policy if exists "host updates game" on games;
create policy "read games"        on games for select to authenticated using (true);
create policy "create games"      on games for insert to authenticated with check (host_id = auth.uid());
create policy "host updates game" on games for update to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());

drop policy if exists "read players" on players;
drop policy if exists "join as self" on players;
drop policy if exists "update self"  on players;
create policy "read players" on players for select to authenticated using (true);
create policy "join as self" on players for insert to authenticated with check (user_id = auth.uid());
create policy "update self"  on players for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read words" on words;
create policy "read words" on words for select to authenticated using (
  exists (select 1 from players p where p.game_id = words.game_id and p.user_id = auth.uid())
);

-- Geheime woorden: JE ZIET ALLEEN JE EIGEN.
drop policy if exists "read own secrets" on secret_words;
create policy "read own secrets" on secret_words for select to authenticated using (
  exists (select 1 from players p where p.id = secret_words.player_id and p.user_id = auth.uid())
);

drop policy if exists "read guesses" on guesses;
create policy "read guesses" on guesses for select to authenticated using (
  exists (select 1 from players p where p.game_id = guesses.game_id and p.user_id = auth.uid())
);

-- ---------------------------------------------------------------------
--  3. REALTIME
-- ---------------------------------------------------------------------
do $do$ begin
  begin alter publication supabase_realtime add table games;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table players; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table words;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table guesses; exception when duplicate_object then null; end;
end $do$;

-- ---------------------------------------------------------------------
--  4. FUNCTIES
-- ---------------------------------------------------------------------
-- ---- start_game: per speler geheime woorden + eigen zwart woord -----
create or replace function start_game(p_game_id uuid, p_words_per int)
returns void language plpgsql security definer set search_path = public as $$
declare v_host uuid; v_status text; v_count int; v_board int; v_player record; v_first uuid; v_black int;
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
    -- geheime woorden
    insert into secret_words (game_id, player_id, word_idx, is_black)
    select p_game_id, v_player.id, idx, false
    from words where game_id = p_game_id order by random() limit p_words_per;

    -- eigen zwart woord: een woord dat NIET bij deze speler hoort
    select w.idx into v_black
    from words w
    where w.game_id = p_game_id
      and not exists (
        select 1 from secret_words sw
        where sw.game_id = p_game_id and sw.player_id = v_player.id and sw.word_idx = w.idx
      )
    order by random() limit 1;

    insert into secret_words (game_id, player_id, word_idx, is_black)
    values (p_game_id, v_player.id, v_black, true)
    on conflict (game_id, player_id, word_idx) do nothing;
  end loop;

  update players set score = 0, guesses_correct = 0, cleared_at = null,
    words_left = p_words_per, best_combo_hint = 0, best_combo_rate = 0
  where game_id = p_game_id;

  select id into v_first from players where game_id = p_game_id order by joined_at limit 1;

  update games set status='playing', phase='clue', turn_number=1, hintgever=v_first,
    clue_word=null, clue_number=null, phase_ends_at=null, words_per=p_words_per,
    hint_found_idxs='{}'
  where id = p_game_id;
end; $$;

-- ---- resolve_turn: scoren met zwart woord van de hintgever ----------
create or replace function resolve_turn(p_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_phase text; v_hint uuid; v_turn int; v_black int; r record;
        v_gain int := 0; v_black_hits int := 0; v_found_now int := 0;
begin
  select phase, hintgever, turn_number into v_phase, v_hint, v_turn
  from games where id = p_game_id;
  if v_phase <> 'guess' then return; end if;

  -- het zwarte woord VAN DE HINTGEVER
  select word_idx into v_black from secret_words
  where game_id = p_game_id and player_id = v_hint and is_black = true;

  -- goed/fout markeren (zwart woord telt nooit als goed)
  update guesses g set correct = exists (
    select 1 from secret_words s
    where s.game_id=p_game_id and s.player_id=v_hint and s.word_idx=g.word_idx
      and s.found=false and s.is_black=false
  )
  where g.game_id=p_game_id and g.turn_number=v_turn;

  -- gevonden markeren
  update secret_words s set found=true
  where s.game_id=p_game_id and s.player_id=v_hint and s.found=false and s.is_black=false
    and s.word_idx in (
      select distinct word_idx from guesses
      where game_id=p_game_id and turn_number=v_turn and correct=true
    );

  select count(distinct word_idx) into v_found_now from guesses
  where game_id=p_game_id and turn_number=v_turn and correct=true;

  -- punten per rader
  for r in
    select rater_id,
           count(*) filter (where correct) as c,
           count(*) filter (where word_idx = v_black) as black_count
    from guesses where game_id=p_game_id and turn_number=v_turn
    group by rater_id
  loop
    if r.c > 0 then
      update players set score = score + (2*r.c - 1),
        guesses_correct = guesses_correct + r.c,
        best_combo_rate = greatest(best_combo_rate, r.c)
      where id = r.rater_id;
      v_gain := v_gain + (2*r.c - 1);
    end if;
    if r.black_count > 0 then
      update players set score = score - 3 where id = r.rater_id;
      v_black_hits := v_black_hits + r.black_count;
    end if;
  end loop;

  update players set score = score + v_gain,
    best_combo_hint = greatest(best_combo_hint, v_found_now)
  where id = v_hint;

  if v_black_hits > 0 then
    update players set score = score - (3 * v_black_hits) where id = v_hint;
  end if;

  -- woorden-over bijwerken (zwart woord telt niet mee)
  update players p set words_left = (
    select count(*) from secret_words sw
    where sw.player_id = p.id and sw.found = false and sw.is_black = false
  ) where p.game_id = p_game_id;

  -- wie is klaar?
  update players p set cleared_at = now()
  where p.game_id=p_game_id and p.cleared_at is null and p.words_left = 0;

  -- gevonden woorden van deze hintgever zichtbaar maken (doorstrepen)
  update games set phase='reveal',
    hint_found_idxs = coalesce((
      select array_agg(sw.word_idx) from secret_words sw
      where sw.game_id=p_game_id and sw.player_id=v_hint and sw.found=true and sw.is_black=false
    ), '{}')
  where id = p_game_id;
end; $$;

-- ---- next_turn: zet ook de doorgestreepte woorden van de nieuwe beurt
create or replace function next_turn(p_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_phase text; v_turn int; v_host uuid; v_next uuid; v_all boolean;
begin
  select phase, turn_number, host_id into v_phase, v_turn, v_host
  from games where id = p_game_id;
  if v_host <> auth.uid() then raise exception 'Alleen de host'; end if;
  if v_phase <> 'reveal' then return; end if;

  -- iedereen klaar? dan is het spel afgelopen
  select not exists (
    select 1 from secret_words sw
    where sw.game_id = p_game_id and sw.found = false and sw.is_black = false
  ) into v_all;

  if v_all then
    update games set status='ended', phase=null where id=p_game_id;
    return;
  end if;

  -- Volgende speler MET woorden over. Spelers die al klaar zijn worden
  -- overgeslagen; ze blijven wel meeraden in andermans beurten.
  -- De afstand loopt circulair vanaf de huidige hintgever: de eerstvolgende
  -- krijgt 1, de huidige speler zelf komt als laatste (alleen als niemand
  -- anders nog woorden heeft).
  with ordered as (
    select id, (row_number() over (order by joined_at)) - 1 as pos,
           count(*) over () as n
    from players where game_id = p_game_id
  ),
  cur as (
    select pos, n from ordered
    where id = (select hintgever from games where id = p_game_id)
  )
  select o.id into v_next
  from ordered o, cur
  where exists (
    select 1 from secret_words sw
    where sw.player_id = o.id and sw.found = false and sw.is_black = false
  )
  order by ((o.pos - cur.pos + cur.n - 1) % cur.n) + 1
  limit 1;

  if v_next is null then
    update games set status='ended', phase=null where id=p_game_id;
    return;
  end if;

  update games set turn_number=v_turn+1, hintgever=v_next,
    phase='clue', clue_word=null, clue_number=null, phase_ends_at=null,
    hint_found_idxs = coalesce((
      select array_agg(sw.word_idx) from secret_words sw
      where sw.game_id=p_game_id and sw.player_id=v_next and sw.found=true and sw.is_black=false
    ), '{}')
  where id = p_game_id;
end; $$;

-- ---- submit_guess: zwart woord mag altijd gekozen worden ------------
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
  if p_word_idxs is not null and array_length(p_word_idxs,1) > 0 then
    insert into guesses (game_id, turn_number, rater_id, word_idx)
    select p_game_id, v_turn, v_me, unnest(p_word_idxs);
  end if;
end; $$;


-- ---- submit_clue ----------------------------------------------------
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

-- ---- end_game -------------------------------------------------------
create or replace function end_game(p_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_host uuid;
begin
  select host_id into v_host from games where id = p_game_id;
  if v_host <> auth.uid() then raise exception 'Alleen de host'; end if;
  update games set status='ended', phase=null where id=p_game_id;
end; $$;

grant execute on function start_game(uuid,int)        to authenticated;
grant execute on function submit_clue(uuid,text,int)  to authenticated;
grant execute on function submit_guess(uuid,int[])    to authenticated;
grant execute on function resolve_turn(uuid)          to authenticated;
grant execute on function next_turn(uuid)             to authenticated;
grant execute on function end_game(uuid)              to authenticated;

-- ---------------------------------------------------------------------
--  5. WOORDENLIJST
-- ---------------------------------------------------------------------
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
