-- =====================================================================
--  SCHAKEL — patch: zwart woord + rejoin
--  Plak dit in de Supabase SQL Editor en klik Run.
-- =====================================================================

-- Kolom voor het zwarte woord
alter table games add column if not exists black_word_idx int;

-- Update start_game: kies een zwart woord (willekeurig uit het bord)
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
    insert into secret_words (game_id, player_id, word_idx)
    select p_game_id, v_player.id, idx
    from words where game_id = p_game_id order by random() limit p_words_per;
  end loop;

  -- Kies een zwart woord: willekeurig uit het bord, NIET iemands geheime woord.
  -- (Zo kun je er nooit punten mee verdienen, alleen verliezen.)
  select w.idx into v_black
  from words w
  where w.game_id = p_game_id
    and not exists (
      select 1 from secret_words sw where sw.game_id = p_game_id and sw.word_idx = w.idx
    )
  order by random()
  limit 1;

  update players set score = 0, guesses_correct = 0, cleared_at = null
  where game_id = p_game_id;

  select id into v_first from players where game_id = p_game_id order by joined_at limit 1;

  update games set status='playing', phase='clue', turn_number=1, hintgever=v_first,
    clue_word=null, clue_number=null, phase_ends_at=null, words_per=p_words_per,
    black_word_idx=v_black
  where id = p_game_id;
end; $$;

-- Update resolve_turn: zwart woord geeft -3 aan rader én hintgever
create or replace function resolve_turn(p_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_phase text; v_hint uuid; v_turn int; v_black int; r record; v_gain int := 0;
        v_black_hits int := 0;
begin
  select phase, hintgever, turn_number, black_word_idx
    into v_phase, v_hint, v_turn, v_black
  from games where id = p_game_id;
  if v_phase <> 'guess' then return; end if;

  -- Markeer goed/fout (los van het zwarte woord)
  update guesses g set correct = exists (
    select 1 from secret_words s
    where s.game_id=p_game_id and s.player_id=v_hint and s.word_idx=g.word_idx and s.found=false
  )
  where g.game_id=p_game_id and g.turn_number=v_turn;

  -- Vind geheime woorden van de hintgever
  update secret_words s set found=true
  where s.game_id=p_game_id and s.player_id=v_hint and s.found=false
    and s.word_idx in (
      select distinct word_idx from guesses
      where game_id=p_game_id and turn_number=v_turn and correct=true
    );

  -- Punten per rader + zwart-woord-straf
  for r in
    select rater_id,
           count(*) filter (where correct) as c,
           count(*) filter (where word_idx = v_black) as black_count
    from guesses where game_id=p_game_id and turn_number=v_turn
    group by rater_id
  loop
    if r.c > 0 then
      update players set score = score + (2*r.c - 1),
        guesses_correct = guesses_correct + r.c
      where id = r.rater_id;
      v_gain := v_gain + (2*r.c - 1);
    end if;
    -- Zwart woord: -3 voor de rader
    if r.black_count > 0 then
      update players set score = score - 3 where id = r.rater_id;
      v_black_hits := v_black_hits + r.black_count;
    end if;
  end loop;

  -- Hintgever krijgt de som van goede punten
  update players set score = score + v_gain where id = v_hint;
  -- Hintgever krijgt -3 per keer dat iemand het zwarte woord raadde
  if v_black_hits > 0 then
    update players set score = score - (3 * v_black_hits) where id = v_hint;
  end if;

  -- Check wie klaar is
  update players p set cleared_at = now()
  where p.game_id=p_game_id and p.cleared_at is null
    and exists (select 1 from secret_words sw where sw.player_id=p.id)
    and not exists (select 1 from secret_words sw where sw.player_id=p.id and sw.found=false);

  update games set phase='reveal' where id = p_game_id;
end; $$;

-- Fix voor next_turn (de "found" ambiguity fix, voor de zekerheid)
create or replace function next_turn(p_game_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_phase text; v_turn int; v_host uuid; v_next uuid; v_all boolean;
begin
  select phase, turn_number, host_id into v_phase, v_turn, v_host
  from games where id = p_game_id;
  if v_host <> auth.uid() then raise exception 'Alleen de host'; end if;
  if v_phase <> 'reveal' then return; end if;

  select not exists (
    select 1 from secret_words sw where sw.game_id = p_game_id and sw.found = false
  ) into v_all;

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
