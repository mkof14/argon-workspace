-- Structure fingerprint of the Workspace schema (no data): tables/columns, functions, policies, triggers, indexes,
-- section access rules. Same query on production (read-only) and on a rehearsal database shows they are the same schema.
with
 cols as (select string_agg(format('%s.%s:%s:%s:%s', table_name, column_name, data_type, is_nullable, coalesce(column_default,'')), '|' order by table_name, column_name) s, count(distinct table_name) n
          from information_schema.columns where table_schema = 'public' and table_name not like '\_%'),
 fns as (select string_agg(format('%s(%s):%s', p.proname, pg_get_function_identity_arguments(p.oid), md5(p.prosrc)), '|' order by p.proname, pg_get_function_identity_arguments(p.oid)) s, count(*) n
          from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname not like '\_%'),
 pol as (select string_agg(format('%s.%s:%s:%s:%s', tablename, policyname, cmd, coalesce(qual,''), coalesce(with_check,'')), '|' order by tablename, policyname) s, count(*) n from pg_policies where schemaname in ('public','storage')),
 trg as (select string_agg(format('%s.%s', c.relname, t.tgname), '|' order by c.relname, t.tgname) s, count(*) n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace where not t.tgisinternal and s.nspname in ('public','auth')),
 idx as (select string_agg(indexname, '|' order by indexname) s, count(*) n from pg_indexes where schemaname = 'public' and tablename not like '\_%'),
 acc as (select string_agg(format('%s:%s', role, section), '|' order by role, section) s, count(*) n from public.section_access)
select json_build_object(
  'tables', (select n from cols), 'columns_md5', md5((select s from cols)),
  'functions', (select n from fns), 'functions_md5', md5((select s from fns)),
  'policies', (select n from pol), 'policies_md5', md5((select s from pol)),
  'triggers', (select n from trg), 'triggers_md5', md5((select s from trg)),
  'indexes', (select n from idx), 'indexes_md5', md5((select s from idx)),
  'access_rules', (select n from acc), 'access_md5', md5((select s from acc))) fp;
