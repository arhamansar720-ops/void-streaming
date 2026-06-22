-- ============================================================
-- VOID — Supabase schema
-- Mirrors the hardcoded `library.shows` structure in index.html,
-- so swapping from local JS data to Supabase is a clean 1:1 move.
-- Run this in Supabase: Project → SQL Editor → New query → paste → Run
-- ============================================================

create table shows (
  id          bigint generated always as identity primary key,
  title       text not null,
  slug        text not null unique,
  tmdb_id     bigint not null,
  created_at  timestamptz default now()
);

create table seasons (
  id          bigint generated always as identity primary key,
  show_id     bigint not null references shows(id) on delete cascade,
  season      int not null,
  unique (show_id, season)
);

create table episodes (
  id          bigint generated always as identity primary key,
  season_id   bigint not null references seasons(id) on delete cascade,
  episode     int not null,
  title       text not null,
  unique (season_id, episode)
);

-- optional: per-user watch history / continue watching / watchlist,
-- to replace localStorage once you add real auth
create table watch_history (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users(id) on delete cascade,
  show_id       bigint references shows(id) on delete cascade,
  season        int not null,
  episode       int not null,
  updated_at    timestamptz default now()
);

create table watchlist (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users(id) on delete cascade,
  show_id       bigint references shows(id) on delete cascade,
  created_at    timestamptz default now(),
  unique (user_id, show_id)
);

-- ============================================================
-- Row Level Security
-- shows/seasons/episodes are public read (anyone can browse the library)
-- watch_history/watchlist are private per-user
-- ============================================================

alter table shows enable row level security;
alter table seasons enable row level security;
alter table episodes enable row level security;
alter table watch_history enable row level security;
alter table watchlist enable row level security;

create policy "public read shows" on shows for select using (true);
create policy "public read seasons" on seasons for select using (true);
create policy "public read episodes" on episodes for select using (true);

create policy "users manage own watch_history" on watch_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "users manage own watchlist" on watchlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- Seed data — same 5 shows currently hardcoded in index.html
-- ============================================================

insert into shows (title, slug, tmdb_id) values
  ('Dexter', 'dexter', 1405),
  ('Breaking Bad', 'breaking-bad', 1396),
  ('The Office', 'the-office', 2316),
  ('Severance', 'severance', 95396),
  ('Stranger Things', 'stranger-things', 66732);

-- Dexter: 4 seasons, 12 episodes each
insert into seasons (show_id, season)
select id, s from shows, generate_series(1,4) s where slug = 'dexter';

insert into episodes (season_id, episode, title)
select se.id, e, 'Episode ' || e
from seasons se
join shows sh on sh.id = se.show_id and sh.slug = 'dexter'
cross join generate_series(1,12) e;

-- Breaking Bad: 5 seasons, episode counts [7,13,13,13,16]
insert into seasons (show_id, season)
select id, s from shows, generate_series(1,5) s where slug = 'breaking-bad';

insert into episodes (season_id, episode, title)
select se.id, e, 'Episode ' || e
from seasons se
join shows sh on sh.id = se.show_id and sh.slug = 'breaking-bad'
cross join generate_series(1,
  case se.season when 1 then 7 when 2 then 13 when 3 then 13 when 4 then 13 when 5 then 16 end
) e;

-- The Office: 3 seasons, episode counts [6,22,23]
insert into seasons (show_id, season)
select id, s from shows, generate_series(1,3) s where slug = 'the-office';

insert into episodes (season_id, episode, title)
select se.id, e, 'Episode ' || e
from seasons se
join shows sh on sh.id = se.show_id and sh.slug = 'the-office'
cross join generate_series(1,
  case se.season when 1 then 6 when 2 then 22 when 3 then 23 end
) e;

-- Severance: 2 seasons, episode counts [9,10]
insert into seasons (show_id, season)
select id, s from shows, generate_series(1,2) s where slug = 'severance';

insert into episodes (season_id, episode, title)
select se.id, e, 'Episode ' || e
from seasons se
join shows sh on sh.id = se.show_id and sh.slug = 'severance'
cross join generate_series(1,
  case se.season when 1 then 9 when 2 then 10 end
) e;

-- Stranger Things: 4 seasons, episode counts [8,9,8,9]
insert into seasons (show_id, season)
select id, s from shows, generate_series(1,4) s where slug = 'stranger-things';

insert into episodes (season_id, episode, title)
select se.id, e, 'Episode ' || e
from seasons se
join shows sh on sh.id = se.show_id and sh.slug = 'stranger-things'
cross join generate_series(1,
  case se.season when 1 then 8 when 2 then 9 when 3 then 8 when 4 then 9 end
) e;
