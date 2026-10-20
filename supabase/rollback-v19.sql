-- Rollback of v19 (Phase 2). Returns the schema to v18 behaviour. Records, comments, files and history stay.
-- BEFORE running: deploy the previous application version (v2.34), otherwise the new screens call functions that are gone.
-- What is lost: notifications and read markers (export them first if wanted: select * from public.notifications),
-- the "request changes" decisions (they become "rejected"), and the new profile fields (department, position,
-- phone, manager, notification settings). Records in the new sections (projects, milestones, document register)
-- stay in the database but are no longer shown until v19 is applied again.
set client_min_messages = warning;
begin;

drop trigger if exists records_notify on public.records;
drop trigger if exists records_rules on public.records;
drop trigger if exists comments_notify on public.comments;
drop trigger if exists comments_prepare on public.comments;
drop trigger if exists approvals_notify on public.approvals;
drop function if exists public.records_notify();
drop function if exists public.record_rules();
drop function if exists public.comments_notify();
drop function if exists public.comment_prepare();
drop function if exists public.approvals_notify();
drop function if exists public.notify_due(date);
drop function if exists public.notifications_claim(integer);
drop function if exists public.notify_user(uuid, text, uuid, text, text, text, uuid, text);
drop function if exists public.notify_channel(jsonb, text, text);
drop function if exists public.record_visible_for(uuid, public.records);
drop table if exists public.notifications;
drop table if exists public.record_reads;

drop policy if exists p_comments_internal on public.comments;
alter table public.comments drop column if exists mentions;
alter table public.comments drop column if exists internal;
drop index if exists public.comments_record_idx;

update public.approvals set status = 'rejected' where status = 'changes_requested';
alter table public.approvals drop constraint if exists approvals_status_check;
alter table public.approvals add constraint approvals_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled', 'expired'));
alter table public.approvals drop column if exists decided_by;

-- task statuses and priorities back to the v18 set (Review → In progress, Cancelled → Done)
alter table public.records disable trigger records_log;
update public.records set status = case status when 'New' then 'Open' when 'Completed' then 'Done' when 'Review' then 'In progress' when 'Cancelled' then 'Done' else status end,
  data = (data - '_v19') || case when status = 'Cancelled' then '{"cancelled": true}'::jsonb else '{}'::jsonb end
  where section = 'company.tasks' and status in ('New', 'Completed', 'Review', 'Cancelled');
update public.records set data = jsonb_set(data, '{priority}', '"Medium"') where section = 'company.tasks' and data->>'priority' = 'Normal';
alter table public.records enable trigger records_log;
drop index if exists public.records_task_assignee_idx;
drop index if exists public.records_project_ref_idx;
drop index if exists public.records_section_status_idx;

delete from public.section_access where section in ('company.projects', 'company.milestones', 'company.documents');
update public.automation_rules set rule = jsonb_set(rule, '{enabled}', 'true') where id in ('task-assigned', 'task-due');

-- protect_profile as in v18
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
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
     or new.disabled is distinct from old.disabled or new.sessions_revoked_at is distinct from old.sessions_revoked_at) then
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
revoke execute on function public.protect_profile() from public, anon, authenticated;
drop function if exists public.is_active_employee(uuid);
alter table public.profiles drop column if exists department;
alter table public.profiles drop column if exists title;
alter table public.profiles drop column if exists phone;
alter table public.profiles drop column if exists manager_id;
alter table public.profiles drop column if exists notify_prefs;

commit;
