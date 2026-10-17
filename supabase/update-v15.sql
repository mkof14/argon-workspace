-- v15: recycle bin (30 days), phone notifications, personal time zone and preferences.

-- Recycle bin: a deleted record (with its comments and approvals) is kept for 30 days and can be restored.
create table if not exists public.records_trash (
  id uuid primary key,
  section text not null,
  title text not null,
  controlled boolean not null default false,
  record jsonb not null,
  comments jsonb not null default '[]'::jsonb,
  deleted_by uuid,
  deleted_at timestamptz not null default now()
);
create index if not exists records_trash_deleted_at_idx on public.records_trash (deleted_at);
alter table public.records_trash enable row level security;
drop policy if exists p_trash_read on public.records_trash;
-- Seen by those who may read the section; US-persons-only records only by US persons; never by partners
create policy p_trash_read on public.records_trash for select to authenticated using (
  public.can_read(section) and not (select public.is_external())
  and (not controlled or coalesce((select us_person from public.profiles where id = (select auth.uid())), false)));

create or replace function public.keep_deleted_record() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.records_trash(id, section, title, controlled, record, comments, deleted_by)
  values (old.id, old.section, old.title, old.controlled, to_jsonb(old),
    coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.comments c where c.record_id = old.id), '[]'::jsonb),
    auth.uid())
  on conflict (id) do update set record = excluded.record, comments = excluded.comments, deleted_by = excluded.deleted_by, deleted_at = now();
  return old;
end $$;
revoke execute on function public.keep_deleted_record() from authenticated, anon, public;
drop trigger if exists records_keep_deleted on public.records;
create trigger records_keep_deleted before delete on public.records for each row execute function public.keep_deleted_record();

-- Phone and browser notifications: one row per device
create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subs (user_id);
alter table public.push_subs enable row level security;
drop policy if exists p_push_own on public.push_subs;
create policy p_push_own on public.push_subs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Personal time zone and preferences (saved views, last visit)
alter table public.profiles add column if not exists timezone text;
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;
