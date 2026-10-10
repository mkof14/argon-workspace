-- AGRON Workspace v0.2 — profile fields, editable access rules, file storage.
-- Safe to run more than once. Then run access.sql to add rules for the new sections.

-- 1. Profile fields for email signatures
alter table public.profiles add column if not exists title text;
alter table public.profiles add column if not exists phone text;

-- 2. People may edit their own name, title, phone and language; only admins change roles and access.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- server (service key) and SQL editor
  if not public.is_admin() and (new.role is distinct from old.role or new.us_person is distinct from old.us_person
     or new.company is distinct from old.company or new.ai_monthly_tokens is distinct from old.ai_monthly_tokens
     or new.email is distinct from old.email or new.id is distinct from old.id) then
    raise exception 'Only administrators can change roles and access';
  end if;
  if old.role = 'owner' and new.role <> 'owner' and (select count(*) from public.profiles where role = 'owner') <= 1 then
    raise exception 'The workspace must keep at least one owner';
  end if;
  if new.role = 'owner' and old.role <> 'owner' and coalesce((select role from public.profiles where id = auth.uid()), '') <> 'owner' then
    raise exception 'Only an owner can appoint another owner';
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles for each row execute function public.protect_profile();
drop policy if exists p_profiles_self on public.profiles;
create policy p_profiles_self on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- 3. Owners and admins edit the access matrix (Users & roles → Roles & access)
drop policy if exists p_access_admin on public.section_access;
create policy p_access_admin on public.section_access for all using (public.is_admin()) with check (public.is_admin());

-- 4. Files: private bucket, path = <section>/<record id>/<file>. Same visibility as the record.
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

create or replace function public.file_visible(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.records r
    where r.id::text = split_part(path, '/', 2) and r.section = split_part(path, '/', 1) and public.record_visible(r))
$$;
create or replace function public.file_writable(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.is_external() and exists (select 1 from public.records r
    where r.id::text = split_part(path, '/', 2) and r.section = split_part(path, '/', 1)
      and public.record_visible(r) and public.can_write(r.section))
$$;
revoke execute on function public.file_visible(text), public.file_writable(text), public.protect_profile() from public, anon;
grant execute on function public.file_visible(text), public.file_writable(text) to authenticated;

drop policy if exists agron_files_read on storage.objects;
create policy agron_files_read on storage.objects for select to authenticated using (bucket_id = 'files' and public.file_visible(name));
drop policy if exists agron_files_insert on storage.objects;
create policy agron_files_insert on storage.objects for insert to authenticated with check (bucket_id = 'files' and public.file_writable(name));
drop policy if exists agron_files_delete on storage.objects;
create policy agron_files_delete on storage.objects for delete to authenticated using (bucket_id = 'files' and public.file_writable(name));
