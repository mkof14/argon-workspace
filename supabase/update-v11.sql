-- AGRON Workspace v1.4 — deadlines in the phone calendar
-- One private subscription link per user. Only the server writes; the user can read their own row.
begin;
create table if not exists public.calendar_feeds (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token text not null unique check (length(token) >= 32),
  scope text not null default 'mine' check (scope in ('mine', 'all')),
  created_at timestamptz not null default now(),
  last_fetch timestamptz
);
alter table public.calendar_feeds enable row level security;
drop policy if exists p_cal_read on public.calendar_feeds;
create policy p_cal_read on public.calendar_feeds for select to authenticated using (user_id = (select auth.uid()));
commit;
