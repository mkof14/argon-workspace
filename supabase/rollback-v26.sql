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

commit;
