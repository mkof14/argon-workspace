-- v19 — Phase 2: daily operations (tasks, projects, people, documents, approvals, discussions, notifications).
-- Builds on v18. Safe to run more than once. Keeps every existing record, comment, file and history row.
-- Rollback: supabase/rollback-v19.sql.
set client_min_messages = warning;
begin;

/* ---------------------------------------------------------------------------------------------
   1. People: department, position, phone, manager, personal notification settings
   --------------------------------------------------------------------------------------------- */
alter table public.profiles add column if not exists department text;
alter table public.profiles add column if not exists title text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists manager_id uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists notify_prefs jsonb not null default '{}'::jsonb;

-- v18 rules + department and manager are set by administrators; title, phone and notification settings by the person
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- server (service key) and SQL editor
  if new.super is distinct from old.super then
    raise exception 'The protected-owner flag can only be changed in the database';
  end if;
  if old.super and auth.uid() <> old.id and (new.role is distinct from old.role or new.us_person is distinct from old.us_person
     or new.company is distinct from old.company or new.ai_monthly_tokens is distinct from old.ai_monthly_tokens or new.email is distinct from old.email
     or new.disabled is distinct from old.disabled or new.sessions_revoked_at is distinct from old.sessions_revoked_at) then
    raise exception 'This owner account is protected and cannot be changed by other users';
  end if;
  if not public.is_admin() and (new.role is distinct from old.role or new.us_person is distinct from old.us_person
     or new.company is distinct from old.company or new.ai_monthly_tokens is distinct from old.ai_monthly_tokens
     or new.email is distinct from old.email or new.id is distinct from old.id
     or new.disabled is distinct from old.disabled or new.sessions_revoked_at is distinct from old.sessions_revoked_at
     or new.department is distinct from old.department or new.manager_id is distinct from old.manager_id) then
    raise exception 'Only administrators can change roles and access';
  end if;
  if old.role = 'owner' and new.role <> 'owner' and (select count(*) from public.profiles where role = 'owner') <= 1 then
    raise exception 'The workspace must keep at least one owner';
  end if;
  if new.role = 'owner' and old.role <> 'owner' and coalesce((select role from public.profiles where id = auth.uid()), '') <> 'owner' then
    raise exception 'Only an owner can appoint another owner';
  end if;
  if new.manager_id = new.id then raise exception 'A person cannot be their own manager'; end if;
  return new;
end $$;
revoke execute on function public.protect_profile() from public, anon, authenticated;

-- An active employee: not switched off, not an external or pending account
create or replace function public.is_active_employee(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and not p.disabled
                 and p.role not in ('partner', 'vendor', 'investor', 'pending'))
$$;
revoke execute on function public.is_active_employee(uuid) from public, anon;
grant execute on function public.is_active_employee(uuid) to authenticated, service_role;

-- What a given person may read (the same rule as record_visible, for someone other than the caller)
create or replace function public.record_visible_for(p_user uuid, r public.records) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and not p.disabled
    and (p.role in ('owner', 'admin') or exists (select 1 from public.section_access a where a.role = p.role and a.section = r.section))
    and (not r.controlled or p.us_person)
    and (p.role not in ('partner', 'vendor', 'investor', 'pending') or r.company = '*' or r.company = p.company))
$$;
revoke execute on function public.record_visible_for(uuid, public.records) from public, anon, authenticated;

/* ---------------------------------------------------------------------------------------------
   2. Tasks: one set of statuses and priorities (existing tasks are mapped, history is not rewritten)
   --------------------------------------------------------------------------------------------- */
alter table public.records disable trigger records_log;
update public.records set status = case status when 'Open' then 'New' when 'Done' then 'Completed' else status end
  where section = 'company.tasks' and status in ('Open', 'Done');
update public.records set data = jsonb_set(data, '{priority}', '"Normal"')
  where section = 'company.tasks' and data->>'priority' = 'Medium';
update public.records set data = jsonb_set(data, '{_v19}', 'true') -- marks rows mapped by this migration (used by the rollback)
  where section = 'company.tasks' and not (data ? '_v19') and status in ('New', 'Completed');
alter table public.records enable trigger records_log;

create index if not exists records_task_assignee_idx on public.records ((data->>'assignee_id')) where section = 'company.tasks';
create index if not exists records_project_ref_idx on public.records ((data->>'project_ref')) where data ? 'project_ref';
create index if not exists records_section_status_idx on public.records (section, status);

/* ---------------------------------------------------------------------------------------------
   3. Rules checked by the database for every change (not only by the screen)
   --------------------------------------------------------------------------------------------- */
create or replace function public.record_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my_role text; d jsonb; od jsonb; pm text; m text;
begin
  if tg_op = 'DELETE' then d := old.data; else d := coalesce(new.data, '{}'::jsonb); end if;
  od := case when tg_op = 'INSERT' then '{}'::jsonb else coalesce(old.data, '{}'::jsonb) end;
  if me is not null then select role into my_role from public.profiles where id = me; end if;
  -- the author is whoever signed in, never what the client sends; it does not change later
  if me is not null and tg_op = 'INSERT' then new.created_by := me; end if;
  if me is not null and tg_op = 'UPDATE' then new.created_by := old.created_by; end if;

  if coalesce(new.section, old.section) = 'company.tasks' then
    -- who may change or delete a task: the person who created it, the person it is assigned to,
    -- the manager of its project, management, owners and administrators
    if me is not null and tg_op in ('UPDATE', 'DELETE') and coalesce(my_role, '') not in ('owner', 'admin', 'management')
       and old.created_by is distinct from me and coalesce(od->>'assignee_id', '') <> me::text then
      select r.data->>'manager_id' into pm from public.records r where r.id::text = od->>'project_ref';
      if coalesce(pm, '') <> me::text then
        raise exception 'Only the author, the person responsible, the project manager or management can change this task' using errcode = '42501';
      end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    -- a task goes only to an active employee (an old assignment stays as it was when the person leaves)
    if d->>'assignee_id' is not null and d->>'assignee_id' <> '' and d->>'assignee_id' is distinct from od->>'assignee_id'
       and not public.is_active_employee((d->>'assignee_id')::uuid) then
      raise exception 'A task can be assigned only to an active employee' using errcode = '23514';
    end if;
    -- completion date is set and cleared by the status
    if new.status = 'Completed' and (tg_op = 'INSERT' or old.status is distinct from 'Completed') then
      new.data := d || jsonb_build_object('completed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD'));
    elsif new.status is distinct from 'Completed' and d ? 'completed_at' then
      new.data := d - 'completed_at';
    end if;
  elsif coalesce(new.section, old.section) = 'company.projects' then
    if tg_op = 'DELETE' then return old; end if;
    if d->>'manager_id' is not null and d->>'manager_id' <> '' and d->>'manager_id' is distinct from od->>'manager_id'
       and not public.is_active_employee((d->>'manager_id')::uuid) then
      raise exception 'The project manager must be an active employee' using errcode = '23514';
    end if;
    if jsonb_typeof(d->'members_ids') = 'array' and d->'members_ids' is distinct from od->'members_ids' then
      for m in select jsonb_array_elements_text(d->'members_ids') loop
        if not (coalesce(od->'members_ids', '[]'::jsonb) ? m) and not public.is_active_employee(m::uuid) then
          raise exception 'Project members must be active employees' using errcode = '23514';
        end if;
      end loop;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke execute on function public.record_rules() from public, anon, authenticated;
drop trigger if exists records_rules on public.records;
create trigger records_rules before insert or update or delete on public.records for each row execute function public.record_rules();

/* ---------------------------------------------------------------------------------------------
   4. Notifications: one row per person and event; the same event never twice (unique key)
   --------------------------------------------------------------------------------------------- */
create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  record_id uuid references public.records(id) on delete cascade,
  section text, title text, body text, actor uuid, link text,
  key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  email_state text check (email_state in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  push_state text check (push_state in ('pending', 'sent', 'failed', 'skipped')),
  delivered_at timestamptz, error text, attempts integer not null default 0, claimed_at timestamptz,
  unique (user_id, key)
);
alter table public.notifications add column if not exists claimed_at timestamptz;
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index if not exists notifications_delivery_idx on public.notifications (created_at) where email_state = 'pending' or push_state = 'pending';
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated; -- a person can only mark their own as read
grant all on public.notifications to service_role;
grant usage on sequence public.notifications_id_seq to service_role;
drop policy if exists p_notifications_read on public.notifications;
-- own notifications only, and only while the record is still visible to the person (row-level security of records applies)
create policy p_notifications_read on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (record_id is null or exists (select 1 from public.records r where r.id = notifications.record_id)));
drop policy if exists p_notifications_mark on public.notifications;
create policy p_notifications_mark on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists p_session_notifications on public.notifications;
create policy p_session_notifications on public.notifications as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));

-- default channels when a person has not chosen: in-app for everything; email and phone for what needs action
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

-- Events on records: assignment, reassignment, status, project membership, milestones, announcements
create or replace function public.records_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d jsonb := coalesce(new.data, '{}'::jsonb); od jsonb := '{}'::jsonb; a text; oa text; u uuid; pm uuid; m text; due text;
begin
  if tg_op = 'UPDATE' then od := coalesce(old.data, '{}'::jsonb); end if;
  -- translations only: nothing happened
  if tg_op = 'UPDATE' and new.version = old.version then return null; end if;
  due := coalesce(d->>'due', '');
  if new.section = 'company.tasks' then
    a := nullif(d->>'assignee_id', ''); oa := nullif(od->>'assignee_id', '');
    if a is not null and a is distinct from oa then
      perform public.notify_user(a::uuid, case when tg_op = 'INSERT' or oa is null then 'assigned' else 'reassigned' end, new.id,
        'assign:' || new.id || ':' || a || ':' || new.version, new.title, nullif(concat_ws(' · ', nullif(d->>'priority', ''), case when due <> '' then 'due ' || due end), ''), me);
    end if;
    if oa is not null and a is distinct from oa then
      perform public.notify_user(oa::uuid, 'unassigned', new.id, 'unassign:' || new.id || ':' || oa || ':' || new.version, new.title, null, me);
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      perform public.notify_user(new.created_by, 'status', new.id, 'status:' || new.id || ':' || new.version, new.title, old.status || ' → ' || new.status, me);
      if a is not null and a::uuid is distinct from new.created_by then
        perform public.notify_user(a::uuid, 'status', new.id, 'status:' || new.id || ':' || new.version, new.title, old.status || ' → ' || new.status, me);
      end if;
      select nullif(r.data->>'manager_id', '')::uuid into pm from public.records r where r.id::text = d->>'project_ref';
      if pm is not null and new.status in ('Review', 'Completed') then
        perform public.notify_user(pm, 'status', new.id, 'status:' || new.id || ':' || new.version, new.title, old.status || ' → ' || new.status, me);
      end if;
    end if;
  elsif new.section = 'company.projects' then
    if nullif(d->>'manager_id', '') is not null and d->>'manager_id' is distinct from od->>'manager_id' then
      perform public.notify_user((d->>'manager_id')::uuid, 'project_member', new.id, 'pm:' || new.id || ':' || (d->>'manager_id'), new.title, 'Project manager', me);
    end if;
    if jsonb_typeof(d->'members_ids') = 'array' then
      for m in select jsonb_array_elements_text(d->'members_ids') loop
        if not (coalesce(od->'members_ids', '[]'::jsonb) ? m) then
          perform public.notify_user(m::uuid, 'project_member', new.id, 'member:' || new.id || ':' || m, new.title, 'Added to the project team', me);
        end if;
      end loop;
    end if;
  elsif new.section = 'company.milestones' and tg_op = 'UPDATE'
        and (new.status is distinct from old.status or d->>'due' is distinct from od->>'due') then
    for u in select x::uuid from (
        select nullif(p.data->>'manager_id', '') x from public.records p where p.id::text = d->>'project_ref'
        union select jsonb_array_elements_text(case when jsonb_typeof(p.data->'members_ids') = 'array' then p.data->'members_ids' else '[]'::jsonb end)
          from public.records p where p.id::text = d->>'project_ref') s where x is not null loop
      perform public.notify_user(u, 'milestone', new.id, 'ms:' || new.id || ':' || new.version, new.title,
        concat_ws(' · ', case when new.status is distinct from old.status then old.status || ' → ' || new.status end,
                         case when d->>'due' is distinct from od->>'due' then 'date ' || coalesce(od->>'due', '—') || ' → ' || coalesce(d->>'due', '—') end), me);
    end loop;
  elsif new.section = 'operations.comms' and new.status = 'Published' and (tg_op = 'INSERT' or old.status is distinct from 'Published')
        and coalesce(d->>'important', 'false') = 'true' then
    for u in select id from public.profiles where not disabled and role <> 'pending' loop
      perform public.notify_user(u, 'announcement', new.id, 'ann:' || new.id, new.title, left(d->>'body', 300), me);
    end loop;
  end if;
  return null;
end $$;
revoke execute on function public.records_notify() from public, anon, authenticated;
drop trigger if exists records_notify on public.records;
create trigger records_notify after insert or update on public.records for each row execute function public.records_notify();

/* ---------------------------------------------------------------------------------------------
   5. Discussions: mentions by account, internal comments, read markers
   --------------------------------------------------------------------------------------------- */
alter table public.comments add column if not exists mentions uuid[] not null default '{}';
alter table public.comments add column if not exists internal boolean not null default false;
create index if not exists comments_record_idx on public.comments (record_id, created_at);
create index if not exists comments_mentions_idx on public.comments using gin (mentions);

-- mentions are read from the text itself (@[Name](account id)), never trusted from the sender
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

-- internal notes are never shown to partners, vendors or investors
drop policy if exists p_comments_internal on public.comments;
create policy p_comments_internal on public.comments as restrictive for select to authenticated
  using (not internal or not (select public.is_external()));

create table if not exists public.record_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, record_id)
);
alter table public.record_reads enable row level security;
revoke all on public.record_reads from anon;
grant select, insert, update, delete on public.record_reads to authenticated;
grant all on public.record_reads to service_role;
drop policy if exists p_reads_own on public.record_reads;
create policy p_reads_own on public.record_reads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists p_session_record_reads on public.record_reads;
create policy p_session_record_reads on public.record_reads as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));

/* ---------------------------------------------------------------------------------------------
   6. Approvals: "request changes", who decided, notifications both ways
   --------------------------------------------------------------------------------------------- */
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.approvals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.approvals drop constraint %I', c);
  end loop;
end $$;
alter table public.approvals add constraint approvals_status_check check (status in ('pending', 'approved', 'rejected', 'changes_requested', 'cancelled', 'expired'));
alter table public.approvals add column if not exists decided_by uuid references public.profiles(id) on delete set null;

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
drop trigger if exists approvals_notify on public.approvals;
create trigger approvals_notify after insert or update on public.approvals for each row execute function public.approvals_notify();

/* ---------------------------------------------------------------------------------------------
   7. Deadlines: due tomorrow / today and overdue, once per date (called by the scheduler)
   --------------------------------------------------------------------------------------------- */
create or replace function public.notify_due(p_today date default (now() at time zone 'utc')::date) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; who uuid; d date;
begin
  for r in select * from public.records where section in ('company.tasks', 'company.milestones')
             and coalesce(status, '') not in ('Completed', 'Cancelled', 'Done', 'Reached')
             and coalesce(data->>'due', '') ~ '^\d{4}-\d{2}-\d{2}' loop
    d := left(r.data->>'due', 10)::date;
    who := coalesce(nullif(r.data->>'assignee_id', ''), nullif(r.data->>'owner_id', ''), (select nullif(p.data->>'manager_id', '') from public.records p where p.id::text = r.data->>'project_ref'))::uuid;
    if who is null then who := r.created_by; end if;
    if d between p_today and p_today + 1 then
      if public.notify_user(who, 'due_soon', r.id, 'due:' || r.id || ':' || d, r.title, 'due ' || d, null) then n := n + 1; end if;
    elsif d < p_today then
      if public.notify_user(who, 'overdue', r.id, 'over:' || r.id || ':' || d, r.title, 'was due ' || d, null) then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.notify_due(date) from public, anon, authenticated;
grant execute on function public.notify_due(date) to service_role;

-- delivery: the scheduler takes pending email/phone notifications in batches, never the same row twice at once
-- a row taken by a worker that then stopped is taken again after 10 minutes (claimed_at), never by two at once
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

/* ---------------------------------------------------------------------------------------------
   8. New sections: projects, milestones, document register (access for the internal roles)
   --------------------------------------------------------------------------------------------- */
insert into public.section_access(section, role, can_write, external)
select s, r, true, false from unnest(array['company.projects', 'company.milestones', 'company.documents']) s,
  unnest(array['management', 'engineering', 'operations', 'finance', 'sales', 'marketing', 'hr', 'legal', 'security']) r
on conflict (section, role) do nothing;

-- the old automatic task e-mails are replaced by personal notifications (one channel, personal settings)
update public.automation_rules set rule = jsonb_set(rule, '{enabled}', 'false') where id in ('task-assigned', 'task-due');

commit;
