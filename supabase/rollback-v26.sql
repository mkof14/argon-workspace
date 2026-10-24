-- AGRON Workspace — rollback of v26 to v25. One transaction; safe to run twice; no data is touched.
begin;

drop function if exists public.workspace_db_version();

do $$
declare f text;
begin
  foreach f in array array[
    'public.class_meta(text)',
    'public.records_crm_after()', 'public.records_crm_before()',
    'public.records_ops_after()', 'public.records_ops_before()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('grant execute on function %s to public, anon', f);
    end if;
  end loop;
end $$;

-- backup of every table, operations statistics: back to the v21 restore (core tables only)
drop function if exists public.restore_reset(text);
drop function if exists public.backup_meta();
drop function if exists public.backup_tables();
drop function if exists public.ops_db_stats();
drop function if exists public.restore_load(text, jsonb, integer);
create or replace function public.restore_load(p_table text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; cols text; sets text; conflict text;
begin
  if p_table not in ('section_access', 'departments', 'profiles', 'taxonomy', 'doc_number_formats', 'doc_counters', 'records', 'document_versions', 'comments', 'activity', 'approvals', 'faq', 'document_access_log') then
    raise exception 'table % cannot be restored', p_table;
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then return 0; end if;
  select string_agg(quote_ident(c.column_name), ', '), string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ') filter (where c.column_name not in ('id', 'kind', 'code', 'prefix'))
    into cols, sets
    from information_schema.columns c where c.table_schema = 'public' and c.table_name = p_table and c.column_name in (select jsonb_object_keys(p_rows->0))
      and c.is_generated = 'NEVER' and c.column_name <> 'tsv';
  if p_table = 'departments' then -- the target's starting list gives way to the backed-up one (same codes, original ids)
    delete from public.departments d where d.code in (select x->>'code' from jsonb_array_elements(p_rows) x) and d.id::text not in (select x->>'id' from jsonb_array_elements(p_rows) x)
      and not exists (select 1 from public.profiles p where p.department_id = d.id);
  end if;
  conflict := case p_table when 'profiles' then 'on conflict (id) do update set ' || sets
    when 'departments' then 'on conflict (id) do update set ' || sets
    when 'taxonomy' then 'on conflict (kind, code) do update set ' || sets
    when 'doc_number_formats' then 'on conflict (id) do update set ' || sets
    when 'doc_counters' then 'on conflict (prefix) do update set last = greatest(public.doc_counters.last, excluded.last)'
    else 'on conflict do nothing' end;
  if p_table = 'records' then alter table public.records disable trigger records_log; end if;
  execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) %3$s', p_table, cols, conflict) using p_rows;
  get diagnostics n = row_count;
  if p_table = 'records' then alter table public.records enable trigger records_log; end if;
  if p_table = 'activity' then perform setval(pg_get_serial_sequence('public.activity', 'id'), greatest(1, (select coalesce(max(id), 1) from public.activity))); end if;
  if p_table = 'document_access_log' then perform setval(pg_get_serial_sequence('public.document_access_log', 'id'), greatest(1, (select coalesce(max(id), 1) from public.document_access_log))); end if;
  return n;
end $$;
revoke execute on function public.restore_load(text, jsonb) from public, anon, authenticated;
grant execute on function public.restore_load(text, jsonb) to service_role;

commit;
