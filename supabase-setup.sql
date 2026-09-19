-- MDTS PT Tracker: database setup for Supabase
-- Run this once in the Supabase SQL Editor (paste the whole file, then Run).
-- It creates the tables, the first-signup-becomes-admin rule, and the
-- row level security policies that keep each member's data private.

-- 1. Member profiles (one row per auth user)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  email text not null,
  role text not null default 'member' check (role in ('member', 'admin')),
  rank text not null default '',
  flight text not null default '',
  pfa_due_date date,
  pfa_score numeric check (pfa_score is null or (pfa_score >= 0 and pfa_score <= 100)),
  created_at timestamptz not null default now()
);

-- 2. Daily PT logs (one row per member per day)
create table if not exists public.pt_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null,
  activities jsonb not null default '[]'::jsonb,
  duration_minutes int not null check (duration_minutes > 0 and duration_minutes <= 1440),
  notes text not null default '',
  session_type text,
  intensity text check (intensity in ('Low', 'Moderate', 'High', 'Maximum')),
  rpe int check (rpe between 1 and 10),
  title text not null default '',
  location text not null default '',
  distance_miles numeric,
  reps int,
  ptl_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, log_date)
);

-- 2b. Migration for installs created before the rich workout-log fields
-- (2026-09-19). Safe to run on any install; existing rows are untouched.
alter table public.pt_logs add column if not exists session_type text;
alter table public.pt_logs add column if not exists intensity text
  check (intensity in ('Low', 'Moderate', 'High', 'Maximum'));
alter table public.pt_logs add column if not exists rpe int
  check (rpe between 1 and 10);
alter table public.pt_logs add column if not exists title text not null default '';
alter table public.pt_logs add column if not exists location text not null default '';
alter table public.pt_logs add column if not exists distance_miles numeric;
alter table public.pt_logs add column if not exists reps int;
alter table public.pt_logs add column if not exists ptl_verified boolean not null default false;

-- 3. The first person to create an account becomes the admin
create or replace function public.set_first_admin()
returns trigger
language plpgsql
security definer
as $$
begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    new.role := 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_first_admin on public.profiles;
create trigger trg_set_first_admin
  before insert on public.profiles
  for each row execute function public.set_first_admin();

-- 4. Helper: is the signed-in user an admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- 5. Keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_logs on public.pt_logs;
create trigger trg_touch_logs
  before update on public.pt_logs
  for each row execute function public.touch_updated_at();

-- 6. Row level security
alter table public.profiles enable row level security;
alter table public.pt_logs enable row level security;

drop policy if exists "own profile select" on public.profiles;
create policy "own profile select" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "admin all profiles select" on public.profiles;
create policy "admin all profiles select" on public.profiles
  for select using (public.is_admin());

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles
  for insert with check (auth.uid() = id);

-- No self-service profile UPDATE policy: the app has no profile-editing UI,
-- and the old "own profile update" policy let any member promote their own
-- row to admin (with_check was empty). Removed 2026-09-19.
drop policy if exists "own profile update" on public.profiles;

drop policy if exists "admin profile delete" on public.profiles;
create policy "admin profile delete" on public.profiles
  for delete using (public.is_admin() and auth.uid() <> id);

drop policy if exists "own logs all" on public.pt_logs;
create policy "own logs all" on public.pt_logs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "admin logs select" on public.pt_logs;
create policy "admin logs select" on public.pt_logs
  for select using (public.is_admin());

-- 7. Unit fields on profiles (2026-09-19): rank, flight, PFA tracking.
-- For installs created before these columns, the ALTERs below migrate them.
alter table public.profiles add column if not exists rank text not null default '';
alter table public.profiles add column if not exists flight text not null default '';
alter table public.profiles add column if not exists pfa_due_date date;
alter table public.profiles add column if not exists pfa_score numeric
  check (pfa_score is null or (pfa_score >= 0 and pfa_score <= 100));

-- 8. Official PFA test history (one row per member per test date)
create table if not exists public.pfa_tests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  test_date date not null,
  score numeric not null check (score >= 0 and score <= 100),
  rating text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, test_date)
);

-- 9. Notifications: PT reminders and unit alerts, one row per recipient
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'info',
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- 10. Row level security for the new tables, plus admin write access
alter table public.pfa_tests enable row level security;
alter table public.notifications enable row level security;

-- Admins manage the roster; members still cannot edit any profile row
-- (self-service update stays removed: it once allowed role promotion).
drop policy if exists "admin profile update" on public.profiles;
create policy "admin profile update" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- Admins can log PT on behalf of members (per-row Log PT action)
drop policy if exists "admin logs insert" on public.pt_logs;
create policy "admin logs insert" on public.pt_logs
  for insert with check (public.is_admin());
drop policy if exists "admin logs update" on public.pt_logs;
create policy "admin logs update" on public.pt_logs
  for update using (public.is_admin());
drop policy if exists "admin logs delete" on public.pt_logs;
create policy "admin logs delete" on public.pt_logs
  for delete using (public.is_admin());

-- PFA tests: members see their own, admins see and manage all
drop policy if exists "own pfa select" on public.pfa_tests;
create policy "own pfa select" on public.pfa_tests
  for select using (auth.uid() = user_id);
drop policy if exists "admin pfa select" on public.pfa_tests;
create policy "admin pfa select" on public.pfa_tests
  for select using (public.is_admin());
drop policy if exists "admin pfa write" on public.pfa_tests;
create policy "admin pfa write" on public.pfa_tests
  for all using (public.is_admin()) with check (public.is_admin());

-- Notifications: members read and mark their own read; admins send and audit
drop policy if exists "own notifications select" on public.notifications;
create policy "own notifications select" on public.notifications
  for select using (auth.uid() = user_id);
drop policy if exists "own notifications update" on public.notifications;
create policy "own notifications update" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "admin notifications select" on public.notifications;
create policy "admin notifications select" on public.notifications
  for select using (public.is_admin());
drop policy if exists "admin notifications insert" on public.notifications;
create policy "admin notifications insert" on public.notifications
  for insert with check (public.is_admin());
