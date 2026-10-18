-- v17: client portal links (applied by migration v17_client_portal). Only the server reads this table.
create table if not exists public.client_portal (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.records(id) on delete cascade,
  token_hash text not null unique,
  label text,
  lang text not null default 'en',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days'),
  revoked_at timestamptz,
  last_seen timestamptz,
  requests_today int not null default 0,
  requests_day date
);
create index if not exists client_portal_client_idx on public.client_portal (client_id);
alter table public.client_portal enable row level security;
