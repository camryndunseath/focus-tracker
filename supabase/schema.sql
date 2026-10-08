-- Focus Tracker database
-- Run this once in your Supabase project (SQL Editor → New query → paste → Run).
-- Every row belongs to the signed-in user, and row level security makes sure
-- people can only ever read or change their own rows.

-- One row per finished study or work session
create table if not exists public.sessions (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id           text        not null,                 -- created by the app, unique per user
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  kind         text        not null default 'study' check (kind in ('study', 'work')),
  place        text        not null default '',
  rating       smallint    not null check (rating between 1 and 5),
  distractions jsonb       not null default '[]'::jsonb, -- times you tapped "I got distracted", in ms since 1970
  away_ms      integer     not null default 0 check (away_ms >= 0),
  note         text        not null default '',
  created_at   timestamptz not null default now(),
  primary key (user_id, id),
  check (ended_at > started_at)
);

create index if not exists sessions_user_started_idx on public.sessions (user_id, started_at);

-- One row per daily check-in
create table if not exists public.days (
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  day         date        not null,                  -- sessions before 4am count toward the day before
  wake        time,
  first_thing text        not null default '',
  food        text        not null default '',
  plans       text[]      not null default '{}',
  updated_at  timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.sessions enable row level security;
alter table public.days     enable row level security;

-- Only the owner can see or change their rows
drop policy if exists "Own sessions" on public.sessions;
create policy "Own sessions" on public.sessions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Own days" on public.days;
create policy "Own days" on public.days
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
