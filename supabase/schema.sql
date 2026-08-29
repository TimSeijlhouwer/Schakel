-- =====================================================================
--  SCHAKEL — databaseschema, stap 1: lobby
--  Plak dit in de Supabase SQL Editor en voer het uit.
--  (Later voegen we tabellen toe voor woorden, geheime woorden, hints,
--   gokken en scores — met strengere beveiliging op de geheime woorden.)
-- =====================================================================

create table if not exists games (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  host_id     uuid not null,
  status      text not null default 'lobby',   -- lobby | playing | ended
  created_at  timestamptz not null default now()
);

create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  user_id     uuid not null,
  name        text not null,
  color       text not null,
  joined_at   timestamptz not null default now(),
  unique (game_id, user_id)
);

create index if not exists players_game_idx on players(game_id);

-- --- Row Level Security -------------------------------------------------
-- Lobbygegevens zijn niet geheim, dus lezen mag voor iedereen die is
-- ingelogd. Schrijven mag alleen namens jezelf. De écht geheime data
-- (welke woorden van wie zijn) komt later in een aparte tabel met
-- strengere regels.

alter table games   enable row level security;
alter table players enable row level security;

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

-- --- Realtime -----------------------------------------------------------
-- Zorgt dat wijzigingen live naar de spelers gepusht worden.
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table games;
