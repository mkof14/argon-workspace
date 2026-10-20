-- Rollback of v21 (Phase 4 documents and knowledge). Returns the database to the v20 behaviour.
-- Data-preserving: every record (with its document number and classification), stored version, version row,
-- department, numbering counter and download-audit row stays; the v21 tables and columns remain but are unused
-- by v20 code. No automatic deletion. Re-applying update-v21.sql afterwards is safe.
set client_min_messages = warning;
begin;

drop trigger if exists records_doc_rules on public.records;
drop trigger if exists records_doc_after on public.records;
drop trigger if exists departments_guard on public.departments;
drop trigger if exists profiles_department_sync on public.profiles;
drop trigger if exists document_versions_guard on public.document_versions;
drop trigger if exists storage_version_guard on storage.objects;

-- approvals: queued steps become cancelled requests (v20 knows no queue); v19/v20 states again
update public.approvals set status = 'cancelled', comment = coalesce(comment, 'Approval chain stopped by rollback') where status = 'queued';
alter table public.approvals drop constraint if exists approvals_status_check;
alter table public.approvals add constraint approvals_status_check check (status in ('pending', 'approved', 'rejected', 'changes_requested', 'cancelled', 'expired'));
drop index if exists public.approvals_chain_idx;
drop index if exists public.approvals_version_idx;

-- Storage: deletes follow file_writable again
drop policy if exists agron_files_delete on storage.objects;
create policy agron_files_delete on storage.objects for delete to authenticated using (bucket_id = 'files' and public.file_writable(name));

-- the v20 / earlier versions of the functions v21 replaced
create or replace function public.record_visible(r public.records) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_read(r.section)
    and (not r.controlled or coalesce((select us_person from public.profiles where id = auth.uid()), false))
    and (not public.is_external() or r.company = '*' or r.company = (select company from public.profiles where id = auth.uid()))
$$;
revoke execute on function public.record_visible(public.records) from anon;

create or replace function public.record_visible_for(p_user uuid, r public.records) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and not p.disabled
    and (p.role in ('owner', 'admin') or exists (select 1 from public.section_access a where a.role = p.role and a.section = r.section))
    and (not r.controlled or p.us_person)
    and (p.role not in ('partner', 'vendor', 'investor', 'pending') or r.company = '*' or r.company = p.company))
    and (r.section <> 'company.announcements' or p_user = r.created_by
         or exists (select 1 from public.profiles q where q.id = p_user and q.role in ('owner', 'admin', 'management'))
         or (r.status = 'Published' and p_user in (select public.announcement_audience(r))))
$$;
revoke execute on function public.record_visible_for(uuid, public.records) from public, anon, authenticated;

create or replace function public.announcement_audience(r public.records) returns setof uuid
language sql stable security definer set search_path = public as $$
  with vals as (select lower(trim(v)) v from unnest(string_to_array(coalesce(r.data->>'audience', ''), ',')) v where trim(v) <> '')
  select p.id from public.profiles p
  where not p.disabled and p.role not in ('partner', 'vendor', 'investor', 'pending')
    and (not r.controlled or p.us_person)
    and case coalesce(r.data->>'audience_type', 'company')
      when 'company' then true
      when 'department' then lower(coalesce(p.department, '')) in (select v from vals)
      when 'roles' then lower(p.role) in (select v from vals)
      when 'project' then exists (select 1 from public.records pr where pr.section = 'company.projects'
             and (pr.id::text = r.data->>'audience' or lower(pr.title) in (select v from vals))
             and (coalesce(pr.data->>'manager_id', '') = p.id::text or coalesce(pr.data->'members_ids', '[]'::jsonb) ? p.id::text))
      else false end
$$;
revoke execute on function public.announcement_audience(public.records) from public, anon, authenticated;

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

create or replace function public.approvals_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  select title into t from public.records where id = new.record_id;
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify_user(new.approver_id, 'approval_requested', new.record_id, 'appr:' || new.id, t, new.note, new.requested_by);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'rejected', 'changes_requested') then
    perform public.notify_user(new.requested_by, 'approval_done', new.record_id, 'appr:' || new.id || ':' || new.status, t,
      new.status || coalesce(': ' || new.comment, ''), coalesce(new.decided_by, new.approver_id));
  end if;
  return null;
end $$;
revoke execute on function public.approvals_notify() from public, anon, authenticated;

create or replace function public.restore_load(p_table text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; cols text; sets text;
begin
  if p_table not in ('section_access', 'profiles', 'records', 'comments', 'activity', 'approvals', 'faq') then raise exception 'table % cannot be restored', p_table; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then return 0; end if;
  select string_agg(quote_ident(c.column_name), ', '), string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ') filter (where c.column_name <> 'id')
    into cols, sets
    from information_schema.columns c where c.table_schema = 'public' and c.table_name = p_table and c.column_name in (select jsonb_object_keys(p_rows->0));
  if p_table = 'records' then alter table public.records disable trigger records_log; end if;
  execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) %3$s', p_table, cols,
    case when p_table = 'profiles' then 'on conflict (id) do update set ' || sets else 'on conflict do nothing' end) using p_rows;
  get diagnostics n = row_count;
  if p_table = 'records' then alter table public.records enable trigger records_log; end if;
  if p_table = 'activity' then perform setval(pg_get_serial_sequence('public.activity', 'id'), greatest(1, (select coalesce(max(id), 1) from public.activity))); end if;
  return n;
end $$;
revoke execute on function public.restore_load(text, jsonb) from public, anon, authenticated;
grant execute on function public.restore_load(text, jsonb) to service_role;

-- functions added by v21
drop function if exists public.document_center(text, text, uuid, text, uuid, text, text, text, text, date, date, text, text, integer, integer);
drop function if exists public.corp_search(text, text[], uuid, text, uuid, text, date, date, text, text, integer);
drop function if exists public.calendar_items(date, date, text);
drop function if exists public.decision_log(text, uuid, text, integer);
drop function if exists public.meeting_minutes_approve(uuid);
drop function if exists public.document_review(uuid, text, text);
drop function if exists public.document_version_decided(uuid, text, uuid);
drop function if exists public.document_version_verified(uuid, uuid, boolean, text);
drop function if exists public.document_version_add(uuid, uuid, text, text, bigint, text, text, boolean, text);
drop function if exists public.next_version_label(uuid, boolean);
drop function if exists public.file_deletable(text);
drop function if exists public.storage_version_guard();
drop function if exists public.document_version_guard();
drop function if exists public.records_doc_after();
drop function if exists public.records_doc_rules();
drop function if exists public.allocate_doc_number(text, text, text, uuid);
drop function if exists public.extra_visible(uuid, public.records);
drop function if exists public.class_meta(text);
drop function if exists public.profile_department_sync();
drop function if exists public.department_guard();

-- indexes added by v21 (the numbers stay in the records)
drop index if exists public.records_doc_number_uq;
drop index if exists public.records_text_trgm_idx;
drop index if exists public.records_cal_idx;
drop index if exists public.records_doc_project_idx;
drop index if exists public.records_section_updated_idx;

-- partners no longer read the document register
delete from public.section_access where section = 'company.documents' and role = 'partner';

commit;
