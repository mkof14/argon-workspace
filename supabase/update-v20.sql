-- v20 — Phase 3: communications, collaboration and notifications.
-- Builds on v19. Safe to run more than once. Keeps every record, comment, file and history row.
-- Reuses: comments (now the one message table: replies, edits, withdrawal, review notes, flags, pins, attachments,
-- document versions), notifications, records (announcements and meetings are records), approvals, activity.
-- New tables: comment_revisions (audit of edits and withdrawals), announcement_acks, notification_digests.
-- Rollback: supabase/rollback-v20.sql.
set client_min_messages = warning;
begin;

/* ---------------------------------------------------------------------------------------------
   1. Messages = comments, extended. Every message inherits access from its record (the existing policies).
   --------------------------------------------------------------------------------------------- */
alter table public.comments add column if not exists parent_id uuid references public.comments(id) on delete set null;
alter table public.comments add column if not exists edited_at timestamptz;
alter table public.comments add column if not exists deleted_at timestamptz;
alter table public.comments add column if not exists kind text not null default 'message';
alter table public.comments add column if not exists flag text;
alter table public.comments add column if not exists flagged_by uuid references public.profiles(id) on delete set null;
alter table public.comments add column if not exists flagged_at timestamptz;
alter table public.comments add column if not exists pinned_at timestamptz;
alter table public.comments add column if not exists pinned_by uuid references public.profiles(id) on delete set null;
alter table public.comments add column if not exists file_path text;      -- the document version the note is about
alter table public.comments add column if not exists version_label text;
alter table public.comments add column if not exists refs uuid[] not null default '{}';   -- linked task / document / milestone
alter table public.comments add column if not exists files jsonb not null default '[]'::jsonb; -- [{path,name,size,type}]
alter table public.comments add column if not exists mention_names jsonb not null default '[]'::jsonb; -- [{id,name}] at the time
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'comments_kind_check') then
    alter table public.comments add constraint comments_kind_check check (kind in ('message', 'review', 'approval', 'system'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'comments_flag_check') then
    alter table public.comments add constraint comments_flag_check check (flag is null or flag in ('important', 'decision', 'announcement'));
  end if;
end $$;
-- the automatic lines written by approvals before v20 become "approval" entries (shown apart from the discussion)
update public.comments set kind = 'approval' where kind = 'message' and body ~ '^(✓ Approved|✗ Rejected|↺ Changes requested|→ Sent for approval)';
create index if not exists comments_parent_idx on public.comments (parent_id) where parent_id is not null;
create index if not exists comments_flag_idx on public.comments (record_id) where flag is not null or pinned_at is not null;
create index if not exists comments_author_created_idx on public.comments (author, created_at desc);
create index if not exists comments_created_idx on public.comments (created_at desc);
create index if not exists notifications_waiting_idx on public.notifications (created_at) where email_state in ('pending', 'sending', 'held') or push_state = 'pending';
create index if not exists notifications_unread_thread_idx on public.notifications (user_id, record_id, kind) where read_at is null;
create index if not exists comments_body_trgm_idx on public.comments using gin (lower(body) extensions.gin_trgm_ops);

-- edits and withdrawals keep the earlier text here; nobody reads it through the API (audit evidence only)
create table if not exists public.comment_revisions (
  id bigserial primary key,
  comment_id uuid not null references public.comments(id) on delete cascade,
  record_id uuid not null,
  action text not null check (action in ('edit', 'withdraw')),
  body text not null,
  by_user uuid,
  at timestamptz not null default now()
);
create index if not exists comment_revisions_comment_idx on public.comment_revisions (comment_id);
alter table public.comment_revisions enable row level security;
revoke all on public.comment_revisions from anon, authenticated;
grant all on public.comment_revisions to service_role;
grant usage on sequence public.comment_revisions_id_seq to service_role;

-- who may lead the conversation about a record: owners, administrators, management, and the project manager
create or replace function public.leads_record(p_user uuid, r public.records) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and not p.disabled and p.role in ('owner', 'admin', 'management'))
    or coalesce(r.data->>'manager_id', '') = p_user::text
    or exists (select 1 from public.records pr where pr.id::text = r.data->>'project_ref' and coalesce(pr.data->>'manager_id', '') = p_user::text)
$$;
revoke execute on function public.leads_record(uuid, public.records) from public, anon, authenticated;

-- the link that opens one message
create or replace function public.message_link(r public.records, p_comment uuid) returns text
language sql immutable as $$
  select case when r.section = 'company.projects' then '/projects/' || r.id || '?tab=discussion#c-' || p_comment
              else '/' || replace(r.section, '.', '/') || '?r=' || r.id || '#c-' || p_comment end
$$;

-- before a message is written: the author is the signed-in person, mentions are read from the text and kept only
-- for active people who may read the record, links and files must belong to this record, one level of replies
create or replace function public.comment_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.records; me uuid := auth.uid(); par public.comments; m text; ids uuid[] := '{}'; names jsonb := '[]'; f jsonb; ok jsonb := '[]'; x uuid; refs uuid[] := '{}';
begin
  select * into r from public.records where id = new.record_id;
  if me is not null then
    new.author := me;
    if new.kind not in ('message', 'review') then new.kind := 'message'; end if;
    new.flag := null; new.flagged_by := null; new.flagged_at := null; new.pinned_at := null; new.pinned_by := null;
    new.edited_at := null; new.deleted_at := null; new.created_at := now();
    if public.is_external() then new.internal := false; end if;
  end if;
  if new.parent_id is not null then
    select * into par from public.comments where id = new.parent_id;
    if not found or par.record_id <> new.record_id then raise exception 'A reply must stay in the same discussion' using errcode = '23514'; end if;
    if par.parent_id is not null then new.parent_id := par.parent_id; end if; -- replies stay one level deep
  end if;
  for m in select distinct mm[1] from regexp_matches(new.body, '@\[[^\]]{1,120}\]\(([0-9a-fA-F-]{36})\)', 'g') mm loop
    x := m::uuid;
    if exists (select 1 from public.profiles p where p.id = x and not p.disabled and p.role <> 'pending')
       and public.record_visible_for(x, r)
       and not (new.internal and exists (select 1 from public.profiles p where p.id = x and p.role in ('partner', 'vendor', 'investor'))) then
      ids := ids || x; names := names || jsonb_build_array(jsonb_build_object('id', x, 'name', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = x)));
    end if;
  end loop;
  new.mentions := ids; new.mention_names := names;
  if me is not null then
    foreach x in array coalesce(new.refs, '{}') loop
      if x <> new.record_id and exists (select 1 from public.records l where l.id = x and public.record_visible(l)) then refs := refs || x; end if;
    end loop;
    new.refs := refs;
    for f in select * from jsonb_array_elements(case when jsonb_typeof(new.files) = 'array' then new.files else '[]'::jsonb end) loop
      if coalesce(f->>'path', '') like r.section || '/' || r.id || '/%' and f->>'path' !~ '\.\.' then ok := ok || jsonb_build_array(f); end if;
    end loop;
    new.files := ok;
    if new.file_path is not null and new.file_path not like r.section || '/' || r.id || '/%' then new.file_path := null; new.version_label := null; end if;
  end if;
  return new;
end $$;
revoke execute on function public.comment_prepare() from public, anon, authenticated;
drop trigger if exists comments_prepare on public.comments;
create trigger comments_prepare before insert on public.comments for each row execute function public.comment_prepare();

-- editing and withdrawing one's own message; flags and pins only through comment_flag / comment_pin
create or replace function public.comment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r public.records; m text; ids uuid[] := '{}'; names jsonb := '[]'; x uuid;
begin
  if me is null or current_setting('agron.flagging', true) = txid_current()::text then return new; end if;
  if old.author is distinct from me then raise exception 'Only the author can change a message' using errcode = '42501'; end if;
  if old.deleted_at is not null then raise exception 'This message was withdrawn' using errcode = '42501'; end if;
  if old.kind not in ('message', 'review') then raise exception 'Automatic entries cannot be changed' using errcode = '42501'; end if;
  -- what cannot change
  new.record_id := old.record_id; new.author := old.author; new.created_at := old.created_at; new.kind := old.kind; new.parent_id := old.parent_id;
  new.internal := old.internal; new.flag := old.flag; new.flagged_by := old.flagged_by; new.flagged_at := old.flagged_at;
  new.pinned_at := old.pinned_at; new.pinned_by := old.pinned_by; new.file_path := old.file_path; new.version_label := old.version_label;
  new.refs := old.refs; new.files := old.files;
  if new.deleted_at is not null then -- withdraw: the text leaves the discussion, the evidence stays
    insert into public.comment_revisions(comment_id, record_id, action, body, by_user) values (old.id, old.record_id, 'withdraw', old.body, me);
    insert into public.activity(record_id, section, actor, action, detail) select old.record_id, rr.section, me, 'message_withdrawn', jsonb_build_object('comment', old.id) from public.records rr where rr.id = old.record_id;
    new.deleted_at := now(); new.body := ''; new.mentions := '{}'; new.mention_names := '[]'; new.files := '[]'; new.refs := '{}';
    return new;
  end if;
  if new.body is distinct from old.body then
    if length(trim(new.body)) = 0 then raise exception 'A message cannot be empty — withdraw it instead' using errcode = '23514'; end if;
    insert into public.comment_revisions(comment_id, record_id, action, body, by_user) values (old.id, old.record_id, 'edit', old.body, me);
    new.edited_at := now();
    select * into r from public.records where id = old.record_id;
    for m in select distinct mm[1] from regexp_matches(new.body, '@\[[^\]]{1,120}\]\(([0-9a-fA-F-]{36})\)', 'g') mm loop
      x := m::uuid;
      if exists (select 1 from public.profiles p where p.id = x and not p.disabled and p.role <> 'pending') and public.record_visible_for(x, r)
         and not (old.internal and exists (select 1 from public.profiles p where p.id = x and p.role in ('partner', 'vendor', 'investor'))) then
        ids := ids || x; names := names || jsonb_build_array(jsonb_build_object('id', x, 'name', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = x)));
      end if;
    end loop;
    new.mentions := ids; new.mention_names := names;
  else
    new.edited_at := old.edited_at; new.mentions := old.mentions; new.mention_names := old.mention_names;
  end if;
  return new;
end $$;
revoke execute on function public.comment_guard() from public, anon, authenticated;
drop trigger if exists comments_guard on public.comments;
create trigger comments_guard before update on public.comments for each row execute function public.comment_guard();

revoke update on public.comments from authenticated; -- only the text and the withdrawal can be changed directly
grant update (body, deleted_at) on public.comments to authenticated;
drop policy if exists p_comments_update_own on public.comments;
create policy p_comments_update_own on public.comments for update to authenticated
  using (author = (select auth.uid()) and deleted_at is null and exists (select 1 from public.records r where r.id = comments.record_id and public.record_visible(r)))
  with check (author = (select auth.uid()));

-- the people to tell about a message: those in the conversation, a project's team, the parent's author for replies
create or replace function public.comments_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.records; u uuid; ext boolean; par uuid; link text; body text; v_kind text; team uuid[] := '{}'; pr public.records;
begin
  select * into r from public.records where id = new.record_id; if not found then return null; end if;
  if new.kind = 'approval' or new.kind = 'system' then return null; end if; -- approvals tell people themselves
  link := public.message_link(r, new.id);
  body := left(regexp_replace(new.body, '@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)', '@\1', 'g'), 300);
  foreach u in array new.mentions loop
    perform public.notify_user(u, 'mention', r.id, 'mention:' || new.id || ':' || u, r.title, body, new.author, link);
  end loop;
  if new.parent_id is not null then
    select author into par from public.comments where id = new.parent_id;
    if par is not null and not (par = any(new.mentions)) then
      select role in ('partner', 'vendor', 'investor') into ext from public.profiles where id = par;
      if not (new.internal and coalesce(ext, true)) then
        perform public.notify_user(par, 'reply', r.id, 'reply:' || new.id, r.title, body, new.author, link);
      end if;
    end if;
  end if;
  -- a project's team hears about project messages; other records: the people already in the conversation
  if r.section = 'company.projects' then pr := r;
  else select * into pr from public.records where id::text = r.data->>'project_ref'; end if;
  v_kind := case when r.section = 'company.projects' then 'project_message' else 'comment' end;
  for u in select distinct x from (
      select r.created_by x
      union select nullif(r.data->>'assignee_id', '')::uuid union select nullif(r.data->>'manager_id', '')::uuid
      union select nullif(r.data->>'owner_id', '')::uuid union select nullif(r.data->>'organizer_id', '')::uuid
      union select jsonb_array_elements_text(case when jsonb_typeof(r.data->'members_ids') = 'array' and r.section = 'company.projects' then r.data->'members_ids' else '[]'::jsonb end)::uuid
      union select jsonb_array_elements_text(case when jsonb_typeof(r.data->'participants_ids') = 'array' then r.data->'participants_ids' else '[]'::jsonb end)::uuid
      union select c.author from public.comments c where c.record_id = r.id and c.id <> new.id and c.kind in ('message', 'review') and c.deleted_at is null) s
    where x is not null and not (x = any(new.mentions)) and x is distinct from par loop
    select role in ('partner', 'vendor', 'investor') into ext from public.profiles where id = u;
    -- one unread notice per discussion and person: further messages only raise the discussion's unread count
    if not (new.internal and coalesce(ext, true))
       and not exists (select 1 from public.notifications n where n.user_id = u and n.record_id = r.id and n.kind = v_kind and n.read_at is null) then
      perform public.notify_user(u, v_kind, r.id, 'comment:' || new.id || ':' || u, r.title, body, new.author, link);
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.comments_notify() from public, anon, authenticated;
drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments for each row execute function public.comments_notify();

/* ---------------------------------------------------------------------------------------------
   2. Decisions, flags and pins. A message marked Decision becomes an entry of the decision log for its project.
   --------------------------------------------------------------------------------------------- */
create or replace function public.create_decision(p_source uuid, p_title text, p_text text, p_key text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.records; id uuid; pref text;
begin
  select * into r from public.records where records.id = p_source; if not found then raise exception 'Record not found'; end if;
  perform pg_advisory_xact_lock(hashtext('decision:' || p_key));
  select d.id into id from public.records d where d.section = 'company.decisions' and d.data->>'_idem' = 'decision:' || p_key;
  if id is not null then return id; end if;
  pref := case when r.section = 'company.projects' then r.id::text else r.data->>'project_ref' end;
  insert into public.records(section, title, status, data, controlled, company, created_by)
  values ('company.decisions', left(coalesce(nullif(trim(p_title), ''), 'Decision'), 160), 'Approved',
          jsonb_build_object('_idem', 'decision:' || p_key, 'date', to_char(now() at time zone 'utc', 'YYYY-MM-DD'), 'decision', p_text,
            'source_ref', r.id, 'source_ref_title', r.title, 'source_section', r.section)
          || case when pref is not null then jsonb_build_object('project_ref', pref, 'project_ref_title', (select title from public.records where records.id::text = pref)) else '{}'::jsonb end,
          r.controlled, null, auth.uid())
  returning records.id into id;
  insert into public.activity(record_id, section, actor, action, detail) values (r.id, r.section, auth.uid(), 'decision_created', jsonb_build_object('decision', id, 'key', p_key));
  return id;
end $$;
revoke execute on function public.create_decision(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.comment_flag(p_comment uuid, p_flag text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.comments; r public.records; me uuid := auth.uid(); dec uuid; u uuid; pr public.records; body text;
begin
  if p_flag is not null and p_flag not in ('important', 'decision', 'announcement') then raise exception 'Unknown mark'; end if;
  select * into c from public.comments where id = p_comment; if not found then raise exception 'Message not found'; end if;
  select * into r from public.records where id = c.record_id;
  if me is null or not public.record_visible(r) or not public.leads_record(me, r) or not public.session_ok() then raise exception 'Only the project manager or management can mark messages' using errcode = '42501'; end if;
  if c.deleted_at is not null then raise exception 'This message was withdrawn'; end if;
  perform set_config('agron.flagging', txid_current()::text, true);
  update public.comments set flag = p_flag, flagged_by = case when p_flag is null then null else me end, flagged_at = case when p_flag is null then null else now() end where id = p_comment;
  perform set_config('agron.flagging', '', true);
  insert into public.activity(record_id, section, actor, action, detail) values (r.id, r.section, me, 'message_' || coalesce(p_flag, 'unmarked'), jsonb_build_object('comment', p_comment));
  body := left(regexp_replace(c.body, '@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)', '@\1', 'g'), 300);
  if p_flag = 'decision' then dec := public.create_decision(r.id, split_part(body, E'\n', 1), c.body, 'comment:' || c.id); end if;
  if p_flag is not null then -- the team hears about important messages, decisions and announcements
    if r.section = 'company.projects' then pr := r; else select * into pr from public.records where id::text = r.data->>'project_ref'; end if;
    for u in select distinct x from (select c.author x union select nullif(pr.data->>'manager_id', '')::uuid
        union select jsonb_array_elements_text(case when jsonb_typeof(pr.data->'members_ids') = 'array' then pr.data->'members_ids' else '[]'::jsonb end)::uuid
        union select nullif(r.data->>'assignee_id', '')::uuid) s where x is not null loop
      if not (c.internal and exists (select 1 from public.profiles p where p.id = u and p.role in ('partner', 'vendor', 'investor'))) then
        perform public.notify_user(u, case when p_flag = 'decision' then 'decision' else 'project_message' end, r.id, 'flag:' || c.id || ':' || p_flag || ':' || u, r.title, body, me, public.message_link(r, c.id));
      end if;
    end loop;
  end if;
  return jsonb_build_object('flag', p_flag, 'decision', dec);
end $$;
revoke execute on function public.comment_flag(uuid, text) from public, anon;
grant execute on function public.comment_flag(uuid, text) to authenticated;

create or replace function public.comment_pin(p_comment uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c public.comments; r public.records; me uuid := auth.uid();
begin
  select * into c from public.comments where id = p_comment; if not found then raise exception 'Message not found'; end if;
  select * into r from public.records where id = c.record_id;
  if me is null or not public.record_visible(r) or not public.leads_record(me, r) or not public.session_ok() then raise exception 'Only the project manager or management can pin messages' using errcode = '42501'; end if;
  perform set_config('agron.flagging', txid_current()::text, true);
  update public.comments set pinned_at = case when p_on then now() end, pinned_by = case when p_on then me end where id = p_comment;
  perform set_config('agron.flagging', '', true);
  insert into public.activity(record_id, section, actor, action, detail) values (r.id, r.section, me, case when p_on then 'message_pinned' else 'message_unpinned' end, jsonb_build_object('comment', p_comment));
end $$;
revoke execute on function public.comment_pin(uuid, boolean) from public, anon;
grant execute on function public.comment_pin(uuid, boolean) to authenticated;

-- @ suggestions: only active people who may read this record; partners and vendors see only the people working on it
create or replace function public.mention_candidates(p_record uuid, p_q text default '', p_internal boolean default false) returns table (id uuid, name text, department text, role text)
language plpgsql stable security definer set search_path = public as $$
declare r public.records; me uuid := auth.uid(); ext boolean; pr public.records;
begin
  select * into r from public.records where records.id = p_record;
  if not found or me is null or not public.record_visible(r) or not public.session_ok() then return; end if;
  ext := public.is_external();
  select * into pr from public.records where records.id::text = r.data->>'project_ref';
  return query
    select p.id, coalesce(nullif(p.full_name, ''), p.email), p.department, p.role from public.profiles p
    where p.id <> me and not p.disabled and p.role <> 'pending' and public.record_visible_for(p.id, r)
      and not (p_internal and p.role in ('partner', 'vendor', 'investor'))
      and (coalesce(p_q, '') = '' or lower(coalesce(p.full_name, '') || ' ' || p.email) like '%' || lower(p_q) || '%')
      and (not ext or p.id = r.created_by or p.id::text in (r.data->>'assignee_id', r.data->>'manager_id', r.data->>'owner_id', pr.data->>'manager_id')
           or exists (select 1 from public.comments c where c.record_id = r.id and c.author = p.id)
           or coalesce(r.data->'members_ids', '[]'::jsonb) ? p.id::text)
    order by 2 limit 8;
end $$;
revoke execute on function public.mention_candidates(uuid, text, boolean) from public, anon;
grant execute on function public.mention_candidates(uuid, text, boolean) to authenticated;

-- a new version of a document: its owner and the project manager hear about it (only after the file is stored)
create or replace function public.document_version_uploaded(p_record uuid, p_path text, p_label text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare r public.records; me uuid := auth.uid(); u uuid; n integer := 0;
begin
  select * into r from public.records where id = p_record;
  if not found or me is null or not public.record_visible(r) or not public.session_ok() then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_path not like r.section || '/' || r.id || '/%' or not exists (select 1 from storage.objects o where o.bucket_id = 'files' and o.name = p_path) then raise exception 'File not found'; end if;
  insert into public.activity(record_id, section, actor, action, detail) values (r.id, r.section, me, 'new_version', jsonb_build_object('path', p_path, 'label', p_label));
  for u in select distinct x from (select nullif(r.data->>'owner_id', '')::uuid x union select r.created_by
      union select nullif(pr.data->>'manager_id', '')::uuid from public.records pr where pr.id::text = r.data->>'project_ref'
      union select a.approver_id from public.approvals a where a.record_id = r.id and a.status = 'pending') s where x is not null loop
    if public.notify_user(u, 'doc_version', r.id, 'ver:' || p_path || ':' || u, r.title, coalesce(p_label, split_part(p_path, '/', 3)), me) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.document_version_uploaded(uuid, text, text) from public, anon;
grant execute on function public.document_version_uploaded(uuid, text, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   3. Notifications: categories, mandatory events, quiet hours and daily summaries (enforced at delivery)
   --------------------------------------------------------------------------------------------- */
alter table public.notifications add column if not exists critical boolean not null default false;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.notifications'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%email_state%' loop
    execute format('alter table public.notifications drop constraint %I', c);
  end loop;
end $$;
alter table public.notifications add constraint notifications_email_state_check check (email_state in ('pending', 'sending', 'held', 'sent', 'failed', 'uncertain', 'skipped'));

-- events that cannot be switched off: critical announcements and security notices
create or replace function public.notify_mandatory(p_kind text) returns boolean language sql immutable as $$ select p_kind in ('announcement_critical', 'security') $$;

create or replace function public.notify_channel(p_prefs jsonb, p_channel text, p_kind text) returns boolean
language sql immutable as $$
  select public.notify_mandatory(p_kind)
    or (coalesce(p_prefs->>(p_channel || '_mode'), 'immediate') <> 'off'
        and coalesce(p_prefs->p_channel, '["assigned","reassigned","mention","reply","approval_requested","approval_done","due_soon","overdue","announcement","decision"]'::jsonb) ? p_kind)
$$;

create or replace function public.notify_user(p_user uuid, p_kind text, p_record uuid, p_key text, p_title text, p_body text, p_actor uuid, p_link text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare pr public.profiles; r public.records; n integer; crit boolean := public.notify_mandatory(p_kind);
begin
  if p_user is null or (p_user = p_actor and not crit) then return false; end if;
  select * into pr from public.profiles where id = p_user;
  if not found or pr.disabled or pr.role = 'pending' then return false; end if;
  if p_record is not null then
    select * into r from public.records where id = p_record;
    if not found or not public.record_visible_for(p_user, r) then return false; end if;
  end if;
  if not crit and coalesce(pr.notify_prefs->'muted', '[]'::jsonb) ? p_kind then return false; end if;
  insert into public.notifications(user_id, kind, record_id, section, title, body, actor, link, key, email_state, push_state, critical)
  values (p_user, p_kind, p_record, r.section, left(coalesce(p_title, r.title, ''), 300), left(p_body, 1000), p_actor, p_link, p_key,
          case when public.notify_channel(pr.notify_prefs, 'email', p_kind) and pr.email is not null then 'pending' end,
          case when public.notify_channel(pr.notify_prefs, 'push', p_kind) and exists (select 1 from public.push_subs s where s.user_id = p_user) then 'pending' end, crit)
  on conflict (user_id, key) do nothing;
  get diagnostics n = row_count; return n > 0;
end $$;
revoke execute on function public.notify_user(uuid, text, uuid, text, text, text, uuid, text) from public, anon, authenticated;

-- a held e-mail (quiet hours, daily summary) goes back to the queue when its time comes
create or replace function public.notifications_release(p_ids bigint[], p_state text) returns void
language sql security definer set search_path = public as $$
  update public.notifications set email_state = case when email_state = 'sending' then p_state else email_state end, claimed_at = now(), attempts = greatest(0, attempts - 1) where id = any(p_ids)
$$;
revoke execute on function public.notifications_release(bigint[], text) from public, anon, authenticated;
grant execute on function public.notifications_release(bigint[], text) to service_role;

create or replace function public.notifications_claim(p_limit integer default 50) returns setof public.notifications
language sql security definer set search_path = public as $$
  update public.notifications n set email_state = case when n.email_state in ('pending', 'sending', 'held') then 'sending' else n.email_state end, attempts = n.attempts + 1, claimed_at = now()
  where n.id in (select id from public.notifications where (email_state in ('pending', 'sending', 'held') or push_state = 'pending') and attempts < 5
                   and (claimed_at is null or claimed_at < now() - interval '10 minutes' or (email_state = 'held' and claimed_at < now() - interval '5 minutes'))
                 order by created_at limit p_limit for update skip locked)
  returning n.*
$$;
revoke execute on function public.notifications_claim(integer) from public, anon, authenticated;
grant execute on function public.notifications_claim(integer) to service_role;

-- one daily summary per person and day
create table if not exists public.notification_digests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  sent_at timestamptz not null default now(),
  items integer not null default 0,
  primary key (user_id, day)
);
alter table public.notification_digests enable row level security;
revoke all on public.notification_digests from anon, authenticated;
grant all on public.notification_digests to service_role;

/* ---------------------------------------------------------------------------------------------
   4. Company announcements (records of company.announcements): audience, versions, acknowledgements
   --------------------------------------------------------------------------------------------- */
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

create or replace function public.announcement_visible(r public.records) returns boolean
language sql stable security definer set search_path = public as $$
  select r.section <> 'company.announcements'
    or coalesce((select p.role in ('owner', 'admin', 'management') from public.profiles p where p.id = auth.uid()), false)
    or r.created_by = auth.uid()
    or (r.status = 'Published' and coalesce(r.data->>'publish_at', '') <= to_char(now() at time zone 'utc', 'YYYY-MM-DD')
        and (coalesce(r.data->>'expires', '') = '' or r.data->>'expires' >= to_char(now() at time zone 'utc', 'YYYY-MM-DD'))
        and auth.uid() in (select public.announcement_audience(r)))
$$;
revoke execute on function public.announcement_visible(public.records) from public, anon;
grant execute on function public.announcement_visible(public.records) to authenticated;
-- outside the audience an announcement does not exist (lists, search, comments, files and notifications all go
-- through record visibility)
drop policy if exists p_records_announcements on public.records;
create policy p_records_announcements on public.records as restrictive for select to authenticated using (public.announcement_visible(records));

-- record_visible_for (who may be told) also respects the audience
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

create table if not exists public.announcement_acks (
  announcement_id uuid not null references public.records(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  version integer not null,
  acked_at timestamptz not null default now(),
  primary key (announcement_id, user_id, version)
);
create index if not exists announcement_acks_user_idx on public.announcement_acks (user_id);
alter table public.announcement_acks enable row level security;
revoke all on public.announcement_acks from anon;
grant select on public.announcement_acks to authenticated;
grant all on public.announcement_acks to service_role;
drop policy if exists p_acks_own on public.announcement_acks;
create policy p_acks_own on public.announcement_acks for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists p_session_announcement_acks on public.announcement_acks;
create policy p_session_announcement_acks on public.announcement_acks as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));

-- the version goes up when the title or the text changes (not for status, dates or a typo in spacing)
create or replace function public.announcement_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare norm_new text; norm_old text;
begin
  if new.section <> 'company.announcements' then return new; end if;
  norm_new := lower(regexp_replace(coalesce(new.title, '') || ' ' || coalesce(new.data->>'message', ''), '\s+', ' ', 'g'));
  if tg_op = 'INSERT' then new.data := new.data || jsonb_build_object('ann_version', 1); return new; end if;
  norm_old := lower(regexp_replace(coalesce(old.title, '') || ' ' || coalesce(old.data->>'message', ''), '\s+', ' ', 'g'));
  new.data := new.data || jsonb_build_object('ann_version', coalesce((old.data->>'ann_version')::int, 1) + case when norm_new <> norm_old then 1 else 0 end);
  return new;
end $$;
revoke execute on function public.announcement_version() from public, anon, authenticated;
drop trigger if exists records_announcement_version on public.records;
create trigger records_announcement_version before insert or update on public.records for each row execute function public.announcement_version();

-- tell the audience once per version when it is published (now, or by the scheduler when its date comes)
create or replace function public.announcement_dispatch(p_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare r public.records; u uuid; n integer := 0; v int; crit boolean;
begin
  select * into r from public.records where id = p_id and section = 'company.announcements';
  if not found or r.status <> 'Published' or coalesce(r.data->>'publish_at', '') > to_char(now() at time zone 'utc', 'YYYY-MM-DD')
     or (coalesce(r.data->>'expires', '') <> '' and r.data->>'expires' < to_char(now() at time zone 'utc', 'YYYY-MM-DD')) then return 0; end if;
  v := coalesce((r.data->>'ann_version')::int, 1); crit := coalesce(r.data->>'priority', '') = 'Critical';
  for u in select public.announcement_audience(r) loop
    if public.notify_user(u, case when crit then 'announcement_critical' else 'announcement' end, r.id, 'ann:' || r.id || ':v' || v || ':' || u, r.title,
         left(regexp_replace(coalesce(r.data->>'message', ''), '[#*_`>]', '', 'g'), 300), case when crit then null else r.created_by end) then n := n + 1; end if;
  end loop;
  if not exists (select 1 from public.activity a where a.record_id = r.id and a.action = 'announcement_published' and a.detail->>'version' = v::text) then
    insert into public.activity(record_id, section, actor, action, detail) values (r.id, r.section, auth.uid(), 'announcement_published', jsonb_build_object('version', v, 'notified', n));
  end if;
  return n;
end $$;
revoke execute on function public.announcement_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.announcement_dispatch(uuid) to service_role;

create or replace function public.announcements_dispatch_due() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from public.records where section = 'company.announcements' and status = 'Published' loop n := n + public.announcement_dispatch(r.id); end loop;
  return n;
end $$;
revoke execute on function public.announcements_dispatch_due() from public, anon, authenticated;
grant execute on function public.announcements_dispatch_due() to service_role;

create or replace function public.records_announce() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.section = 'company.announcements' and new.status = 'Published' then perform public.announcement_dispatch(new.id); end if;
  return null;
end $$;
revoke execute on function public.records_announce() from public, anon, authenticated;
drop trigger if exists records_announce on public.records;
create trigger records_announce after insert or update on public.records for each row execute function public.records_announce();

create or replace function public.announcement_ack(p_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare r public.records; me uuid := auth.uid(); v int;
begin
  select * into r from public.records where id = p_id and section = 'company.announcements';
  if not found or me is null or not public.record_visible(r) or not public.announcement_visible(r) or not public.session_ok() then raise exception 'Not found' using errcode = '42501'; end if;
  v := coalesce((r.data->>'ann_version')::int, 1);
  insert into public.announcement_acks(announcement_id, user_id, version) values (p_id, me, v) on conflict do nothing;
  if found then insert into public.activity(record_id, section, actor, action, detail) values (r.id, r.section, me, 'acknowledged', jsonb_build_object('version', v)); end if;
  insert into public.record_reads(user_id, record_id, read_at) values (me, p_id, now()) on conflict (user_id, record_id) do update set read_at = now();
  return v;
end $$;
revoke execute on function public.announcement_ack(uuid) from public, anon;
grant execute on function public.announcement_ack(uuid) to authenticated;

-- for the author and management: audience size, read, acknowledged (this version) and who is still outstanding
create or replace function public.announcement_stats(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.records; me uuid := auth.uid(); v int; aud uuid[];
begin
  select * into r from public.records where id = p_id and section = 'company.announcements';
  if not found or me is null or not public.session_ok() or not (r.created_by = me or exists (select 1 from public.profiles p where p.id = me and p.role in ('owner', 'admin', 'management'))) then raise exception 'Not allowed' using errcode = '42501'; end if;
  v := coalesce((r.data->>'ann_version')::int, 1);
  select array_agg(x) into aud from public.announcement_audience(r) x;
  return jsonb_build_object('version', v, 'audience', coalesce(array_length(aud, 1), 0),
    'read', (select count(*) from public.record_reads rr where rr.record_id = p_id and rr.user_id = any(aud)),
    'acknowledged', (select count(*) from public.announcement_acks a where a.announcement_id = p_id and a.version = v and a.user_id = any(aud)),
    'outstanding', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email)) order by p.full_name) from public.profiles p
       where p.id = any(aud) and coalesce(r.data->>'ack_required', 'false') = 'true'
         and not exists (select 1 from public.announcement_acks a where a.announcement_id = p_id and a.user_id = p.id and a.version = v)), '[]'::jsonb));
end $$;
revoke execute on function public.announcement_stats(uuid) from public, anon;
grant execute on function public.announcement_stats(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   5. Meetings: an action item becomes a task exactly once
   --------------------------------------------------------------------------------------------- */
create or replace function public.meeting_action_to_task(p_meeting uuid, p_item text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.records; me uuid := auth.uid(); it jsonb; items jsonb; idx int; tid uuid; key text := 'meeting:' || p_meeting || ':' || p_item;
begin
  select * into m from public.records where id = p_meeting and section = 'company.meetings';
  if not found or me is null or not public.record_visible(m) or not public.session_ok() then raise exception 'Meeting not found' using errcode = '42501'; end if;
  if not (m.created_by = me or coalesce(m.data->>'organizer_id', '') = me::text or public.leads_record(me, m)) then raise exception 'Only the meeting owner can create tasks from it' using errcode = '42501'; end if;
  if not public.can_write('company.tasks') then raise exception 'No right to create tasks' using errcode = '42501'; end if;
  items := case when jsonb_typeof(m.data->'action_items') = 'array' then m.data->'action_items' else '[]'::jsonb end;
  select ord - 1, e into idx, it from jsonb_array_elements(items) with ordinality t(e, ord) where e->>'id' = p_item;
  if it is null then raise exception 'Action item not found'; end if;
  perform pg_advisory_xact_lock(hashtext(key));
  select id into tid from public.records where section = 'company.tasks' and data->>'_idem' = key;
  if tid is null then
    insert into public.records(section, title, status, data, controlled, created_by)
    values ('company.tasks', left(coalesce(nullif(trim(it->>'title'), ''), 'Action item'), 200), 'New',
      jsonb_strip_nulls(jsonb_build_object('_idem', key, 'description', it->>'description', 'assignee_id', nullif(it->>'assignee_id', ''),
        'assignee', (select coalesce(nullif(full_name, ''), email) from public.profiles where id::text = it->>'assignee_id'),
        'due', nullif(it->>'due', ''), 'priority', 'Normal', 'project_ref', m.data->>'project_ref', 'project_ref_title', m.data->>'project_ref_title',
        'meeting_ref', m.id, 'meeting_ref_title', m.title, 'related', '/company/meetings?r=' || m.id)), m.controlled, me)
    returning id into tid;
    insert into public.activity(record_id, section, actor, action, detail) values (m.id, m.section, me, 'task_from_meeting', jsonb_build_object('task', tid, 'item', p_item));
  end if;
  update public.records set data = jsonb_set(data, array['action_items', idx::text, 'task_id'], to_jsonb(tid::text)) where id = m.id and data->'action_items'->idx->>'task_id' is distinct from tid::text;
  return tid;
end $$;
revoke execute on function public.meeting_action_to_task(uuid, text) from public, anon;
grant execute on function public.meeting_action_to_task(uuid, text) to authenticated;

create or replace function public.record_decision(p_source uuid, p_text text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.records; me uuid := auth.uid();
begin
  select * into r from public.records where id = p_source;
  if not found or me is null or not public.record_visible(r) or not public.session_ok() then raise exception 'Not found' using errcode = '42501'; end if;
  if not (r.created_by = me or coalesce(r.data->>'organizer_id', '') = me::text or public.leads_record(me, r)) then raise exception 'Only the owner can record decisions here' using errcode = '42501'; end if;
  return public.create_decision(r.id, split_part(p_text, E'\n', 1), p_text, 'text:' || r.id || ':' || md5(lower(trim(p_text))));
end $$;
revoke execute on function public.record_decision(uuid, text) from public, anon;
grant execute on function public.record_decision(uuid, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   6. Search across discussions: the same access rules as reading them (record visibility, internal notes, session)
   --------------------------------------------------------------------------------------------- */
create or replace function public.search_messages(p_q text, p_project uuid default null, p_author uuid default null, p_from date default null, p_to date default null,
  p_kind text default null, p_mentions_me boolean default false, p_decisions boolean default false, p_limit integer default 30)
returns table (id uuid, record_id uuid, section text, title text, project_ref text, author uuid, created_at timestamptz, excerpt text, flag text, kind text)
language plpgsql stable security definer set search_path = public as $$
-- The same rules as reading a discussion (p_comments_read, p_comments_internal, p_session_*), applied once per record
-- instead of once per message: first the records this person may open, then only their messages.
declare me uuid := auth.uid(); ext boolean; w1 text;
begin
  if me is null or not public.session_ok() or length(trim(coalesce(p_q, ''))) < 2 then return; end if;
  ext := public.is_external();
  w1 := replace(replace(replace(lower(split_part(trim(p_q), ' ', 1)), '\', '\\'), '%', '\%'), '_', '\_');
  return query
  with vis as materialized (
    select r.id, r.section, r.title, r.data from public.records r
    where (p_project is null or r.id = p_project or r.data->>'project_ref' = p_project::text)
      and public.record_visible(r) and public.announcement_visible(r))
  select c.id, c.record_id, v.section, v.title, coalesce(case when v.section = 'company.projects' then v.id::text end, v.data->>'project_ref'), c.author, c.created_at,
    left(regexp_replace(substr(c.body, greatest(1, strpos(lower(c.body), lower(split_part(trim(p_q), ' ', 1))) - 60), 220), '@\[([^\]]+)\]\([0-9a-fA-F-]{36}\)', '@\1', 'g'), 220),
    c.flag, c.kind
  from public.comments c join vis v on v.id = c.record_id
  where c.deleted_at is null and not (c.internal and ext)
    and lower(c.body) like '%' || w1 || '%'
    and not exists (select 1 from unnest(string_to_array(lower(trim(p_q)), ' ')) w where w <> '' and position(w in lower(c.body || ' ' || v.title)) = 0)
    and (p_author is null or c.author = p_author)
    and (p_from is null or c.created_at >= p_from) and (p_to is null or c.created_at < p_to + 1)
    and (p_kind is null or v.section = p_kind or c.kind = p_kind)
    and (not p_mentions_me or me = any(c.mentions))
    and (not p_decisions or c.flag = 'decision')
  order by c.created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100);
end $$;
revoke execute on function public.search_messages(text, uuid, uuid, date, date, text, boolean, boolean, integer) from public, anon;
grant execute on function public.search_messages(text, uuid, uuid, date, date, text, boolean, boolean, integer) to authenticated;

/* ---------------------------------------------------------------------------------------------
   7. History follows the record: nobody reads the history of a record they may not open (titles stay hidden)
   --------------------------------------------------------------------------------------------- */
drop policy if exists p_activity_record on public.activity;
create policy p_activity_record on public.activity as restrictive for select to authenticated
  using (record_id is null
         or exists (select 1 from public.records r where r.id = activity.record_id and public.record_visible(r) and public.announcement_visible(r))
         or (not exists (select 1 from public.records r where r.id = activity.record_id) and (select public.is_admin())));

/* ---------------------------------------------------------------------------------------------
   8. Operations: delivery problems for administrators, without the content of messages
   --------------------------------------------------------------------------------------------- */
create or replace function public.communication_issues(p_days integer default 14) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not public.is_admin() or not public.session_ok() then raise exception 'Administrators only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'notifications', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('id', n.id, 'kind', n.kind, 'user', coalesce(nullif(p.full_name, ''), p.email), 'section', n.section,
          'record', case when r.id is not null and public.record_visible(r) then n.record_id end,
          'title', case when r.id is not null and public.record_visible(r) then r.title end,
          'email', n.email_state, 'push', n.push_state, 'attempts', n.attempts, 'error', left(n.error, 300), 'at', n.created_at) x
        from public.notifications n left join public.profiles p on p.id = n.user_id left join public.records r on r.id = n.record_id
        where n.created_at > now() - make_interval(days => p_days) and (n.email_state in ('failed', 'uncertain') or n.push_state = 'failed' or (n.email_state = 'pending' and n.attempts >= 3))
        order by n.created_at desc limit 200) s), '[]'::jsonb),
    'outbound', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'to', o.to_addr, 'error', left(o.last_error, 300), 'at', o.updated_at) order by o.updated_at desc)
        from (select * from public.outbound_messages where status not in ('sent') and updated_at > now() - make_interval(days => p_days) order by updated_at desc limit 100) o), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('job', j.job, 'slot', j.slot, 'status', j.status, 'error', left(j.error, 300), 'at', j.started_at) order by j.started_at desc)
        from (select * from public.job_runs where status in ('failed', 'dead', 'timeout') and started_at > now() - make_interval(days => p_days) and job in ('notify', 'due', 'announce', 'calendar', 'intake', 'retry') order by started_at desc limit 50) j), '[]'::jsonb),
    'calendar', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'error', left(e.message, 300)) order by e.created_at desc)
        from (select * from public.app_errors where agent like 'gcal%' and created_at > now() - make_interval(days => p_days) order by created_at desc limit 50) e), '[]'::jsonb),
    'announcements', coalesce((select jsonb_agg(jsonb_build_object('record', r.id, 'title', case when public.record_visible(r) then r.title end,
          'notified', (select count(*) from public.notifications n where n.record_id = r.id),
          'email_failed', (select count(*) from public.notifications n where n.record_id = r.id and n.email_state in ('failed', 'uncertain'))))
        from public.records r where r.section = 'company.announcements' and r.updated_at > now() - make_interval(days => p_days)), '[]'::jsonb),
    'totals', jsonb_build_object(
      'pending_email', (select count(*) from public.notifications where email_state in ('pending', 'sending', 'held')),
      'failed_email', (select count(*) from public.notifications where email_state = 'failed' and created_at > now() - make_interval(days => p_days)),
      'uncertain_email', (select count(*) from public.notifications where email_state = 'uncertain' and created_at > now() - make_interval(days => p_days)),
      'failed_push', (select count(*) from public.notifications where push_state = 'failed' and created_at > now() - make_interval(days => p_days))));
end $$;
revoke execute on function public.communication_issues(integer) from public, anon;
grant execute on function public.communication_issues(integer) to authenticated;

/* ---------------------------------------------------------------------------------------------
   9. Partners may see the projects shared with their company (read only; discussion internal by default)
   --------------------------------------------------------------------------------------------- */
insert into public.section_access(section, role, can_write, external) values ('company.projects', 'partner', false, true) on conflict (section, role) do nothing;
insert into public.section_access(section, role, can_write, external)
select 'company.announcements', r, r = 'management', false from unnest(array['management', 'engineering', 'operations', 'finance', 'sales', 'marketing', 'hr', 'legal', 'security']) r
on conflict (section, role) do nothing;

commit;
