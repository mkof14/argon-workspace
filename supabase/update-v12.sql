-- AGRON Workspace v1.5 — one-click approvals
-- A request goes to one approver by email; the link (secret token, single use, 14 days) opens a confirm page.
begin;
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (length(token) >= 32),
  record_id uuid not null references public.records(id) on delete cascade,
  section text not null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  approver_id uuid not null references public.profiles(id) on delete cascade,
  note text check (length(note) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  comment text check (length(comment) <= 2000),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days'
);
create index if not exists approvals_record_idx on public.approvals (record_id, created_at desc);
create index if not exists approvals_approver_idx on public.approvals (approver_id) where status = 'pending';
create index if not exists approvals_requested_by_idx on public.approvals (requested_by);
alter table public.approvals enable row level security;
drop policy if exists p_approvals_read on public.approvals;
create policy p_approvals_read on public.approvals for select to authenticated
  using (requested_by = (select auth.uid()) or approver_id = (select auth.uid()) or (select public.is_admin()));
-- No write policies: only the server (service role) creates and decides approvals.
commit;
