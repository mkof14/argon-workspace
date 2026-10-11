-- AGRON Workspace v1.1 — RLS performance + error log
-- 1) auth.uid() and argument-free helpers wrapped in (select …) so Postgres evaluates them once per query, not per row
-- 2) one permissive policy per table/action (profiles UPDATE, section_access)
-- 3) app_errors: client/server error log, readable by admins only

begin;

drop policy if exists p_ai_read on public.ai_usage;
create policy p_ai_read on public.ai_usage for select using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists p_activity_read on public.activity;
create policy p_activity_read on public.activity for select using (public.can_read(section) and not (select public.is_external()));

drop policy if exists p_comments_insert on public.comments;
create policy p_comments_insert on public.comments for insert with check (author = (select auth.uid()) and exists (select 1 from public.records r where r.id = comments.record_id and public.record_visible(r.*)));

drop policy if exists p_faq_delete on public.faq;
create policy p_faq_delete on public.faq for delete using ((select public.can_curate()) or created_by = (select auth.uid()));
drop policy if exists p_faq_insert on public.faq;
create policy p_faq_insert on public.faq for insert with check (not (select public.is_external()) and (not verified or (select public.can_curate())));
drop policy if exists p_faq_read on public.faq;
create policy p_faq_read on public.faq for select using ((select auth.uid()) is not null and (not (select public.is_external()) or verified));
drop policy if exists p_faq_update on public.faq;
create policy p_faq_update on public.faq for update using ((select public.can_curate()) or created_by = (select auth.uid()))
  with check ((select public.can_curate()) or (created_by = (select auth.uid()) and not verified));

drop policy if exists p_profiles_read on public.profiles;
create policy p_profiles_read on public.profiles for select using (id = (select auth.uid()) or not (select public.is_external()));
drop policy if exists p_profiles_admin on public.profiles;
drop policy if exists p_profiles_self on public.profiles;
create policy p_profiles_update on public.profiles for update
  using ((select public.is_admin()) or id = (select auth.uid()))
  with check ((select public.is_admin()) or id = (select auth.uid()));

drop policy if exists p_records_delete on public.records;
create policy p_records_delete on public.records for delete using ((select public.is_admin()) or (created_by = (select auth.uid()) and public.can_write(section)));
drop policy if exists p_records_insert on public.records;
create policy p_records_insert on public.records for insert with check (public.can_write(section) and not (select public.is_external())
  and (not controlled or coalesce((select p.us_person from public.profiles p where p.id = (select auth.uid())), false)));
drop policy if exists p_records_update on public.records;
create policy p_records_update on public.records for update
  using (public.record_visible(records.*) and public.can_write(section) and not (select public.is_external()))
  with check (public.can_write(section) and (not controlled or coalesce((select p.us_person from public.profiles p where p.id = (select auth.uid())), false)));

drop policy if exists p_access_admin on public.section_access;
drop policy if exists p_access_read on public.section_access;
create policy p_access_read on public.section_access for select using ((select auth.uid()) is not null);
create policy p_access_insert on public.section_access for insert with check ((select public.is_admin()));
create policy p_access_update on public.section_access for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy p_access_delete on public.section_access for delete using ((select public.is_admin()));

-- Error log
create table if not exists public.app_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  source text not null default 'client' check (source in ('client','server','uptime')),
  message text not null check (length(message) <= 2000),
  stack text check (length(stack) <= 8000),
  url text check (length(url) <= 500),
  agent text check (length(agent) <= 300),
  version text check (length(version) <= 20),
  resolved boolean not null default false
);
create index if not exists app_errors_created_idx on public.app_errors (created_at desc);
create index if not exists app_errors_user_idx on public.app_errors (user_id);
alter table public.app_errors enable row level security;
drop policy if exists p_errors_insert on public.app_errors;
create policy p_errors_insert on public.app_errors for insert to authenticated with check (user_id = (select auth.uid()) and source = 'client');
drop policy if exists p_errors_read on public.app_errors;
create policy p_errors_read on public.app_errors for select to authenticated using ((select public.is_admin()));
drop policy if exists p_errors_update on public.app_errors;
create policy p_errors_update on public.app_errors for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists p_errors_delete on public.app_errors;
create policy p_errors_delete on public.app_errors for delete to authenticated using ((select public.is_admin()));

commit;
