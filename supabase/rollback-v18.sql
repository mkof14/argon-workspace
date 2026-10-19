-- Rollback of v18 (Phase 1). Returns the schema to v17 behaviour. Records, comments and files are not touched.
-- BEFORE running: deploy the previous application version (v2.33), otherwise the new code calls functions that are gone.
-- Data that exists only in the new tables (automation queue and log, job history, delivery rows, rate counters)
-- is exported first by the operator: `select * from public.automation_queue` etc. → save as CSV.
-- Hashed approval and calendar links cannot be turned back into readable tokens: after a rollback those links
-- stop working and people create new ones (approvals: send again; calendar: My profile → new link).
set client_min_messages = warning;
begin;

-- sessions and MFA
do $$ declare t text; begin
  foreach t in array array['records', 'comments', 'activity', 'approvals', 'doc_pages', 'faq', 'section_access', 'records_trash', 'ai_usage', 'push_subs', 'calendar_feeds', 'gcal_links', 'app_errors', 'profiles'] loop
    execute format('drop policy if exists p_session_%1$s on public.%1$I', t);
  end loop;
end $$;
drop policy if exists p_session_files on storage.objects;
drop policy if exists p_security_read on public.security_settings;
drop function if exists public.session_ok();
drop function if exists public.revoke_sessions(uuid);
drop table if exists public.security_settings;

-- functions
drop function if exists public.automation_claim_keys(text[], integer[]);
drop function if exists public.automation_enqueue(jsonb);
drop function if exists public.automation_save_rules(jsonb, text);
drop function if exists public.automation_decide(uuid, boolean, text, boolean, jsonb);
drop function if exists public.automation_claim_due(integer, integer);
drop function if exists public.automation_finish(uuid, uuid, boolean, text, text, boolean);
drop function if exists public.automation_requeue(uuid, text);
drop function if exists public.outbound_claim(text, text, text, uuid);
drop function if exists public.outbound_done(uuid, text, text, text);
drop function if exists public.outbound_mark_stuck(integer);
drop function if exists public.job_start(text, text, text, integer, integer);
drop function if exists public.job_heartbeat(uuid);
drop function if exists public.job_finish(uuid, text, text, jsonb);
drop function if exists public.job_revive(text, text);
drop function if exists public.rate_hit(text, integer, integer);
drop function if exists public.records_apply(jsonb);
drop function if exists public.can_read_as(uuid, text);
drop function if exists public.restore_load(text, jsonb);

-- tables
drop table if exists public.outbound_messages;
drop table if exists public.automation_queue;
drop table if exists public.automation_log;
drop table if exists public.automation_rules;
drop table if exists public.automation_settings;
drop table if exists public.automation_fired;
drop table if exists public.job_runs;
drop table if exists public.rate_limits;
drop table if exists public.ops_state;

-- records: the version column stays harmless, but the v17 trigger is restored
drop index if exists public.records_idem_key;
create or replace function public.log_record_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity(record_id, section, actor, action, detail) values (new.id, new.section, auth.uid(), 'created', jsonb_build_object('title', new.title, 'status', new.status));
  elsif tg_op = 'UPDATE' then
    if new.title is not distinct from old.title and new.status is not distinct from old.status
       and new.company is not distinct from old.company and new.controlled is not distinct from old.controlled
       and (new.data - '_tr') is not distinct from (old.data - '_tr') then
      new.updated_at := old.updated_at;
      return new;
    end if;
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
alter table public.records drop column if exists version;

-- links (token_hash columns stay; the v17 code ignores them)
drop index if exists public.approvals_token_hash_idx;
drop index if exists public.calendar_feeds_token_hash_idx;

-- execute rights on policy helpers for anonymous callers as before
grant execute on function public.record_visible(public.records) to anon;
grant execute on function public.can_read(text) to anon;
grant execute on function public.can_write(text) to anon;
grant execute on function public.file_visible(text) to anon;
grant execute on function public.file_writable(text) to anon;

-- profiles: new columns are kept (harmless); protect_profile keeps checking them, which v17 code never changes
commit;
