-- v16: Google Calendar two-way sync (applied by migration v16_google_calendar).
create table if not exists public.gcal_links (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  google_email text, refresh_enc text not null, calendar_id text not null default 'primary',
  sync_token text, last_sync timestamptz, last_error text, connected_at timestamptz not null default now()
);
alter table public.gcal_links enable row level security;
create policy p_gcal_own_read on public.gcal_links for select to authenticated using (user_id = (select auth.uid()));
create policy p_gcal_own_delete on public.gcal_links for delete to authenticated using (user_id = (select auth.uid()));
create table if not exists public.gcal_map (
  user_id uuid not null references public.profiles(id) on delete cascade, record_id uuid not null, event_id text not null,
  origin text not null default 'workspace', updated_at timestamptz not null default now(), primary key (user_id, record_id)
);
create index if not exists gcal_map_event_idx on public.gcal_map (user_id, event_id);
alter table public.gcal_map enable row level security; -- server only
