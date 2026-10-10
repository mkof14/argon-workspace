-- AGRON Workspace — database schema (Supabase / Postgres)
-- Run once in Supabase → SQL Editor. Then run access.sql and seed.sql.

create extension if not exists pgcrypto;

-- ---------- People ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  role text not null default 'pending',
  company text,                         -- for partner / vendor / investor users: their company name
  us_person boolean not null default false, -- export control: may see records marked "controlled"
  lang text not null default 'en',
  ai_monthly_tokens integer not null default 300000,
  created_at timestamptz not null default now()
);

-- First user becomes owner; everyone else starts as 'pending' until an admin assigns a role.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when exists (select 1 from public.profiles) then 'pending' else 'owner' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- Access map (generated from workspace.config.mjs → access.sql) ----------
create table if not exists public.section_access (
  section text not null,
  role text not null,
  can_write boolean not null default false,
  external boolean not null default false,
  primary key (section, role)
);

-- ---------- Records: one table for every section ----------
create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  section text not null,                 -- e.g. 'operations.builds'
  title text not null,
  status text,
  data jsonb not null default '{}'::jsonb,
  company text,                          -- null = internal only; '*' = all external users; else that company
  controlled boolean not null default false, -- US persons only
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists records_section_idx on public.records(section);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records(id) on delete cascade,
  author uuid references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.activity (
  id bigserial primary key,
  record_id uuid,
  section text,
  actor uuid,
  action text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  id bigserial primary key,
  user_id uuid references public.profiles(id),
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

-- ---------- Helper functions ----------
create or replace function public.my_profile() returns public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid()
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin') from public.profiles where id = auth.uid()), false)
$$;
create or replace function public.can_read(sec text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.section_access a join public.profiles p on p.role = a.role
    where p.id = auth.uid() and a.section = sec)
$$;
create or replace function public.can_write(sec text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.section_access a join public.profiles p on p.role = a.role
    where p.id = auth.uid() and a.section = sec and a.can_write)
$$;
create or replace function public.is_external() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('partner','vendor','investor','pending') from public.profiles where id = auth.uid()), true)
$$;
create or replace function public.record_visible(r public.records) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_read(r.section)
    and (not r.controlled or coalesce((select us_person from public.profiles where id = auth.uid()), false))
    and (not public.is_external() or r.company = '*' or r.company = (select company from public.profiles where id = auth.uid()))
$$;

-- ---------- Row-level security ----------
alter table public.profiles enable row level security;
alter table public.section_access enable row level security;
alter table public.records enable row level security;
alter table public.comments enable row level security;
alter table public.activity enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists p_profiles_read on public.profiles;
create policy p_profiles_read on public.profiles for select using (id = auth.uid() or not public.is_external());
drop policy if exists p_profiles_admin on public.profiles;
create policy p_profiles_admin on public.profiles for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_access_read on public.section_access;
create policy p_access_read on public.section_access for select using (auth.uid() is not null);

drop policy if exists p_records_read on public.records;
create policy p_records_read on public.records for select using (public.record_visible(records));
drop policy if exists p_records_insert on public.records;
create policy p_records_insert on public.records for insert with check (
  public.can_write(section) and not public.is_external()
  and (not controlled or coalesce((select us_person from public.profiles where id = auth.uid()), false)));
drop policy if exists p_records_update on public.records;
create policy p_records_update on public.records for update using (public.record_visible(records) and public.can_write(section) and not public.is_external())
  with check (public.can_write(section) and (not controlled or coalesce((select us_person from public.profiles where id = auth.uid()), false)));
drop policy if exists p_records_delete on public.records;
create policy p_records_delete on public.records for delete using (public.is_admin() or (created_by = auth.uid() and public.can_write(section)));

drop policy if exists p_comments_read on public.comments;
create policy p_comments_read on public.comments for select using (exists (select 1 from public.records r where r.id = record_id and public.record_visible(r)));
drop policy if exists p_comments_insert on public.comments;
create policy p_comments_insert on public.comments for insert with check (author = auth.uid() and exists (select 1 from public.records r where r.id = record_id and public.record_visible(r)));

drop policy if exists p_activity_read on public.activity;
create policy p_activity_read on public.activity for select using (public.can_read(section) and not public.is_external());

drop policy if exists p_ai_read on public.ai_usage;
create policy p_ai_read on public.ai_usage for select using (user_id = auth.uid() or public.is_admin());
-- ai_usage rows are written by the server with the service key.

-- ---------- Activity log trigger ----------
create or replace function public.log_record_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity(record_id, section, actor, action, detail) values (new.id, new.section, auth.uid(), 'created', jsonb_build_object('title', new.title, 'status', new.status));
  elsif tg_op = 'UPDATE' then
    new.updated_at := now();
    insert into public.activity(record_id, section, actor, action, detail) values (new.id, new.section, auth.uid(),
      case when new.status is distinct from old.status then 'status' else 'updated' end,
      jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status));
  elsif tg_op = 'DELETE' then
    insert into public.activity(record_id, section, actor, action, detail) values (old.id, old.section, auth.uid(), 'deleted', jsonb_build_object('title', old.title));
    return old;
  end if;
  return new;
end $$;
drop trigger if exists records_log on public.records;
create trigger records_log before insert or update or delete on public.records for each row execute function public.log_record_change();

-- Realtime (optional): live updates for records and comments
do $$ begin
  begin alter publication supabase_realtime add table public.records; exception when others then null; end;
  begin alter publication supabase_realtime add table public.comments; exception when others then null; end;
end $$;
