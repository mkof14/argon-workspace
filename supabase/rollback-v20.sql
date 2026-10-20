-- Rollback of v20 (Phase 3 communications). Returns the database to the v19 behaviour.
-- Data-preserving: every message, reply, edit history (comment_revisions), acknowledgement (announcement_acks),
-- notification and record stays. The added columns and tables remain but are no longer used by v19 code
-- (no automatic deletion — Phase 3 rule). Re-applying update-v20.sql afterwards is safe.
set client_min_messages = warning;
begin;

-- triggers and policies added by v20
drop trigger if exists comments_guard on public.comments;
drop trigger if exists records_announcement_version on public.records;
drop trigger if exists records_announce on public.records;
drop policy if exists p_comments_update_own on public.comments;
revoke update (body, deleted_at) on public.comments from authenticated;
grant update on public.comments to authenticated; -- as before v20
drop policy if exists p_records_announcements on public.records;
drop policy if exists p_activity_record on public.activity;
drop policy if exists p_acks_own on public.announcement_acks;
drop policy if exists p_session_announcement_acks on public.announcement_acks;
revoke all on public.announcement_acks from authenticated;

drop index if exists public.notifications_unread_thread_idx;
drop index if exists public.notifications_waiting_idx;

-- functions added by v20
drop function if exists public.comment_guard();
drop function if exists public.comment_flag(uuid, text);
drop function if exists public.comment_pin(uuid, boolean);
drop function if exists public.record_decision(uuid, text);
drop function if exists public.create_decision(uuid, text, text, text);
drop function if exists public.mention_candidates(uuid, text, boolean);
drop function if exists public.document_version_uploaded(uuid, text, text);
drop function if exists public.notifications_release(bigint[], text);
drop function if exists public.announcement_ack(uuid);
drop function if exists public.announcement_stats(uuid);
drop function if exists public.announcements_dispatch_due();
drop function if exists public.announcement_dispatch(uuid);
drop function if exists public.records_announce();
drop function if exists public.announcement_version();
drop function if exists public.meeting_action_to_task(uuid, text);
drop function if exists public.search_messages(text, uuid, uuid, date, date, text, boolean, boolean, integer);
drop function if exists public.communication_issues(integer);

-- notification states v19 does not know go back to the nearest v19 state
update public.notifications set email_state = 'pending', claimed_at = null where email_state = 'held';
update public.notifications set email_state = 'failed', attempts = greatest(attempts, 99) where email_state = 'uncertain';
alter table public.notifications drop constraint if exists notifications_email_state_check;
alter table public.notifications add constraint notifications_email_state_check check (email_state in ('pending', 'sending', 'sent', 'failed', 'skipped'));

-- v19 versions of the functions v20 replaced
create or replace function public.record_visible_for(p_user uuid, r public.records) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and not p.disabled
    and (p.role in ('owner', 'admin') or exists (select 1 from public.section_access a where a.role = p.role and a.section = r.section))
    and (not r.controlled or p.us_person)
    and (p.role not in ('partner', 'vendor', 'investor', 'pending') or r.company = '*' or r.company = p.company))
$$;
revoke execute on function public.record_visible_for(uuid, public.records) from public, anon, authenticated;

create or replace function public.notify_channel(p_prefs jsonb, p_channel text, p_kind text) returns boolean
language sql immutable as $$
  select coalesce(p_prefs->p_channel, '["assigned","reassigned","mention","approval_requested","approval_done","due_soon","overdue","announcement"]'::jsonb) ? p_kind
$$;

create or replace function public.notify_user(p_user uuid, p_kind text, p_record uuid, p_key text, p_title text, p_body text, p_actor uuid, p_link text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare pr public.profiles; r public.records; n integer;
begin
  if p_user is null or p_user = p_actor then return false; end if;
  select * into pr from public.profiles where id = p_user;
  if not found or pr.disabled or pr.role = 'pending' then return false; end if;
  if p_record is not null then
    select * into r from public.records where id = p_record;
    if not found or not public.record_visible_for(p_user, r) then return false; end if;
  end if;
  if coalesce(pr.notify_prefs->'muted', '[]'::jsonb) ? p_kind then return false; end if; -- switched off entirely by the person
  insert into public.notifications(user_id, kind, record_id, section, title, body, actor, link, key, email_state, push_state)
  values (p_user, p_kind, p_record, r.section, left(coalesce(p_title, r.title, ''), 300), left(p_body, 1000), p_actor, p_link, p_key,
          case when public.notify_channel(pr.notify_prefs, 'email', p_kind) and pr.email is not null then 'pending' end,
          case when public.notify_channel(pr.notify_prefs, 'push', p_kind) and exists (select 1 from public.push_subs s where s.user_id = p_user) then 'pending' end)
  on conflict (user_id, key) do nothing;
  get diagnostics n = row_count; return n > 0;
end $$;
revoke execute on function public.notify_user(uuid, text, uuid, text, text, text, uuid, text) from public, anon, authenticated;

create or replace function public.comment_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.mentions := coalesce((select array_agg(distinct m[1]::uuid) from regexp_matches(new.body, '@\[[^\]]{1,120}\]\(([0-9a-fA-F-]{36})\)', 'g') m), '{}');
  -- external users cannot write internal notes
  if new.internal and public.is_external() and auth.uid() is not null then new.internal := false; end if;
  return new;
end $$;
revoke execute on function public.comment_prepare() from public, anon, authenticated;
drop trigger if exists comments_prepare on public.comments;
create trigger comments_prepare before insert on public.comments for each row execute function public.comment_prepare();

create or replace function public.comments_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.records; u uuid; ext boolean;
begin
  select * into r from public.records where id = new.record_id; if not found then return null; end if;
  foreach u in array new.mentions loop
    select role in ('partner', 'vendor', 'investor') into ext from public.profiles where id = u;
    if not (new.internal and coalesce(ext, true)) then
      perform public.notify_user(u, 'mention', r.id, 'mention:' || new.id, r.title, left(regexp_replace(new.body, '@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)', '@\1', 'g'), 300), new.author);
    end if;
  end loop;
  -- the people already in the conversation: author of the record, the person responsible, earlier commenters
  for u in select distinct x from (
      select r.created_by x
      union select nullif(r.data->>'assignee_id', '')::uuid union select nullif(r.data->>'manager_id', '')::uuid
      union select c.author from public.comments c where c.record_id = r.id and c.id <> new.id) s
    where x is not null and not (x = any(new.mentions)) loop
    select role in ('partner', 'vendor', 'investor') into ext from public.profiles where id = u;
    if not (new.internal and coalesce(ext, true)) then
      perform public.notify_user(u, 'comment', r.id, 'comment:' || new.id, r.title, left(regexp_replace(new.body, '@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)', '@\1', 'g'), 300), new.author);
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.comments_notify() from public, anon, authenticated;
drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments for each row execute function public.comments_notify();

create or replace function public.notifications_claim(p_limit integer default 50) returns setof public.notifications
language sql security definer set search_path = public as $$
  update public.notifications n set email_state = case when n.email_state in ('pending', 'sending') then 'sending' else n.email_state end, attempts = n.attempts + 1, claimed_at = now()
  where n.id in (select id from public.notifications where (email_state in ('pending', 'sending') or push_state = 'pending') and attempts < 5
                   and (claimed_at is null or claimed_at < now() - interval '10 minutes')
                 order by created_at limit p_limit for update skip locked)
  returning n.*
$$;
revoke execute on function public.notifications_claim(integer) from public, anon, authenticated;
grant execute on function public.notifications_claim(integer) to service_role;

-- record_visible_for (v19) no longer knows announcements; announcement_visible / audience / leads_record / message_link
-- are dropped after it
drop function if exists public.announcement_visible(public.records);
drop function if exists public.announcement_audience(public.records);
drop function if exists public.leads_record(uuid, public.records);
drop function if exists public.message_link(public.records, uuid);
drop function if exists public.notify_mandatory(text);

-- the announcements section loses its access rows (the records stay; access.sql of v19 had none)
delete from public.section_access where section = 'company.announcements';
delete from public.section_access where section = 'company.projects' and role = 'partner';

commit;
