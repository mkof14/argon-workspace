-- v21 — Phase 4: documents, knowledge, calendar and corporate information.
-- Builds on v20. Safe to run more than once. Keeps every record, file, comment and history row.
-- Reuses: records (documents = company.documents, knowledge = company.wiki, decisions = company.decisions,
-- meetings = company.meetings), approvals, comments, notifications, activity, doc_pages, Storage.
-- New tables: departments, taxonomy (document types, classifications, knowledge categories),
-- doc_number_formats + doc_counters (numbering), document_versions, document_access_log.
-- Rollback: supabase/rollback-v21.sql.
set client_min_messages = warning;
begin;

/* ---------------------------------------------------------------------------------------------
   1. Departments: one directory; profiles point at it, the old text stays as history
   --------------------------------------------------------------------------------------------- */
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{2,10}$'),
  key text not null unique check (key ~ '^[a-z0-9_-]{2,40}$'),   -- stable key used by records and announcements
  name text not null check (length(trim(name)) between 1 and 120),
  label jsonb not null default '{}'::jsonb,                       -- {en, ru, uk, ar}
  manager_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  description text check (length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.departments enable row level security;
revoke all on public.departments from anon;
grant select, insert, update on public.departments to authenticated;
grant all on public.departments to service_role;
drop policy if exists p_departments_read on public.departments;
create policy p_departments_read on public.departments for select to authenticated using (not (select public.is_external()));
drop policy if exists p_departments_write on public.departments;
create policy p_departments_write on public.departments for insert to authenticated with check ((select public.is_admin()));
drop policy if exists p_departments_update on public.departments;
create policy p_departments_update on public.departments for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists p_session_departments on public.departments;
create policy p_session_departments on public.departments as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));

-- the code and key never change (records and announcements point at the key); a rename changes only the name
create or replace function public.department_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then new.code := old.code; new.key := old.key; new.created_at := old.created_at; end if;
  if tg_op = 'INSERT' and coalesce(new.key, '') = '' then new.key := lower(new.code); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists departments_guard on public.departments;
create trigger departments_guard before insert or update on public.departments for each row execute function public.department_guard();

insert into public.departments(code, key, name, label) values
  ('MGT', 'management', 'Management', '{"en":"Management","ru":"Руководство","uk":"Керівництво","ar":"الإدارة"}'),
  ('ENG', 'engineering', 'Engineering & R&D', '{"en":"Engineering & R&D","ru":"Инженерия и R&D","uk":"Інженерія та R&D","ar":"الهندسة والبحث والتطوير"}'),
  ('SW', 'software', 'Software development', '{"en":"Software development","ru":"Разработка ПО","uk":"Розробка ПЗ","ar":"تطوير البرمجيات"}'),
  ('OPS', 'operations', 'Operations & production', '{"en":"Operations & production","ru":"Операции и производство","uk":"Операції та виробництво","ar":"العمليات والإنتاج"}'),
  ('PROC', 'procurement', 'Procurement & logistics', '{"en":"Procurement & logistics","ru":"Закупки и логистика","uk":"Закупівлі та логістика","ar":"المشتريات والخدمات اللوجستية"}'),
  ('FIN', 'finance', 'Finance', '{"en":"Finance","ru":"Финансы","uk":"Фінанси","ar":"المالية"}'),
  ('SAL', 'sales', 'Sales & business development', '{"en":"Sales & business development","ru":"Продажи и развитие бизнеса","uk":"Продажі та розвиток бізнесу","ar":"المبيعات وتطوير الأعمال"}'),
  ('LEG', 'legal', 'Legal & compliance', '{"en":"Legal & compliance","ru":"Юридический и комплаенс","uk":"Юридичний і комплаєнс","ar":"الشؤون القانونية والامتثال"}'),
  ('MKT', 'marketing', 'Marketing', '{"en":"Marketing","ru":"Маркетинг","uk":"Маркетинг","ar":"التسويق"}'),
  ('HR', 'hr', 'Human resources', '{"en":"Human resources","ru":"Персонал","uk":"Персонал","ar":"الموارد البشرية"}'),
  ('SEC', 'security', 'Security', '{"en":"Security","ru":"Безопасность","uk":"Безпека","ar":"الأمن"}')
on conflict (code) do nothing;

alter table public.profiles add column if not exists department_id uuid references public.departments(id) on delete set null;
create index if not exists profiles_department_idx on public.profiles (department_id);
-- existing text values are matched to a department only when they match its key, code or name exactly
-- (case-insensitive); anything else keeps its text and stays unlinked for an administrator to decide
update public.profiles p set department_id = d.id
  from public.departments d
  where p.department_id is null and coalesce(p.department, '') <> ''
    and lower(trim(p.department)) in (d.key, lower(d.code), lower(d.name));

-- choosing a department by id keeps the text key next to it (older screens and reports read the key)
create or replace function public.profile_department_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if new.department_id is distinct from old.department_id then
    if new.department_id is null then return new; end if;
    select key into k from public.departments where id = new.department_id; new.department := k;
  elsif new.department is distinct from old.department and coalesce(new.department, '') <> '' then
    select id into new.department_id from public.departments where key = lower(trim(new.department)) or lower(code) = lower(trim(new.department));
  end if;
  return new;
end $$;
revoke execute on function public.profile_department_sync() from public, anon, authenticated;
drop trigger if exists profiles_department_sync on public.profiles;
create trigger profiles_department_sync before update on public.profiles for each row execute function public.profile_department_sync();

/* ---------------------------------------------------------------------------------------------
   2. Configurable lists: document types (prefix, lifecycle, approval chain), classifications,
      knowledge categories. Administrators edit them; everyone signed in reads them.
   --------------------------------------------------------------------------------------------- */
create table if not exists public.taxonomy (
  kind text not null check (kind in ('doc_type', 'classification', 'knowledge_category')),
  code text not null check (length(code) between 1 and 60),
  label jsonb not null default '{}'::jsonb,
  sort integer not null default 100,
  active boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (kind, code)
);
alter table public.taxonomy enable row level security;
revoke all on public.taxonomy from anon;
grant select, insert, update on public.taxonomy to authenticated;
grant all on public.taxonomy to service_role;
drop policy if exists p_taxonomy_read on public.taxonomy;
create policy p_taxonomy_read on public.taxonomy for select to authenticated using (true);
drop policy if exists p_taxonomy_insert on public.taxonomy;
create policy p_taxonomy_insert on public.taxonomy for insert to authenticated with check ((select public.is_admin()));
drop policy if exists p_taxonomy_update on public.taxonomy;
create policy p_taxonomy_update on public.taxonomy for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists p_session_taxonomy on public.taxonomy;
create policy p_session_taxonomy on public.taxonomy as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));

insert into public.taxonomy(kind, code, label, sort, meta) values
  ('classification', 'Internal', '{"en":"Internal","ru":"Внутренний","uk":"Внутрішній","ar":"داخلي"}', 10, '{}'),
  ('classification', 'Confidential', '{"en":"Confidential","ru":"Конфиденциально","uk":"Конфіденційно","ar":"سري"}', 20, '{"no_external":true}'),
  ('classification', 'Restricted', '{"en":"Restricted","ru":"Ограниченный доступ","uk":"Обмежений доступ","ar":"مقيد"}', 30, '{"no_external":true,"restricted":true}'),
  ('classification', 'US Persons Only', '{"en":"US Persons Only","ru":"Только для US persons","uk":"Лише для US persons","ar":"للأشخاص الأمريكيين فقط"}', 40, '{"no_external":true,"us_only":true}'),
  ('doc_type', 'Contract', '{"en":"Contract","ru":"Договор","uk":"Договір","ar":"عقد"}', 10, '{"prefix":"CON"}'),
  ('doc_type', 'NDA', '{"en":"NDA","ru":"NDA","uk":"NDA","ar":"اتفاقية سرية"}', 20, '{"prefix":"NDA"}'),
  ('doc_type', 'Policy', '{"en":"Policy","ru":"Политика","uk":"Політика","ar":"سياسة"}', 30, '{"prefix":"POL","effective":true}'),
  ('doc_type', 'Procedure', '{"en":"Procedure","ru":"Процедура","uk":"Процедура","ar":"إجراء"}', 40, '{"prefix":"PRC","effective":true}'),
  ('doc_type', 'Technical specification', '{"en":"Technical specification","ru":"Техническая спецификация","uk":"Технічна специфікація","ar":"مواصفة فنية"}', 50, '{"prefix":"SPEC"}'),
  ('doc_type', 'Engineering documentation', '{"en":"Engineering documentation","ru":"Инженерная документация","uk":"Інженерна документація","ar":"وثائق هندسية"}', 60, '{"prefix":"ENG"}'),
  ('doc_type', 'Budget', '{"en":"Budget","ru":"Бюджет","uk":"Бюджет","ar":"ميزانية"}', 70, '{"prefix":"BUD"}'),
  ('doc_type', 'Invoice', '{"en":"Invoice","ru":"Счёт","uk":"Рахунок","ar":"فاتورة"}', 80, '{"prefix":"INV"}'),
  ('doc_type', 'Purchase order', '{"en":"Purchase order","ru":"Заказ на закупку","uk":"Замовлення на закупівлю","ar":"أمر شراء"}', 90, '{"prefix":"PO"}'),
  ('doc_type', 'Supplier quotation', '{"en":"Supplier quotation","ru":"КП поставщика","uk":"Пропозиція постачальника","ar":"عرض مورد"}', 100, '{"prefix":"QUO"}'),
  ('doc_type', 'Certification', '{"en":"Certification","ru":"Сертификат","uk":"Сертифікат","ar":"شهادة"}', 110, '{"prefix":"CERT"}'),
  ('doc_type', 'Meeting minutes', '{"en":"Meeting minutes","ru":"Протокол встречи","uk":"Протокол зустрічі","ar":"محضر اجتماع"}', 120, '{"prefix":"MIN"}'),
  ('doc_type', 'Report', '{"en":"Report","ru":"Отчёт","uk":"Звіт","ar":"تقرير"}', 130, '{"prefix":"REP"}'),
  ('doc_type', 'Presentation', '{"en":"Presentation","ru":"Презентация","uk":"Презентація","ar":"عرض تقديمي"}', 140, '{"prefix":"PRS"}'),
  ('doc_type', 'Other', '{"en":"Other","ru":"Другое","uk":"Інше","ar":"أخرى"}', 900, '{"prefix":"DOC"}'),
  ('knowledge_category', 'Company', '{"en":"Company","ru":"Компания","uk":"Компанія","ar":"الشركة"}', 10, '{}'),
  ('knowledge_category', 'Product', '{"en":"Product","ru":"Продукт","uk":"Продукт","ar":"المنتج"}', 20, '{}'),
  ('knowledge_category', 'Engineering', '{"en":"Engineering","ru":"Инженерия","uk":"Інженерія","ar":"الهندسة"}', 30, '{}'),
  ('knowledge_category', 'Software', '{"en":"Software","ru":"ПО","uk":"ПЗ","ar":"البرمجيات"}', 40, '{}'),
  ('knowledge_category', 'Operations', '{"en":"Operations","ru":"Операции","uk":"Операції","ar":"العمليات"}', 50, '{}'),
  ('knowledge_category', 'Procurement', '{"en":"Procurement","ru":"Закупки","uk":"Закупівлі","ar":"المشتريات"}', 60, '{}'),
  ('knowledge_category', 'Sales', '{"en":"Sales","ru":"Продажи","uk":"Продажі","ar":"المبيعات"}', 70, '{}'),
  ('knowledge_category', 'Legal', '{"en":"Legal","ru":"Юридическое","uk":"Юридичне","ar":"قانوني"}', 80, '{}'),
  ('knowledge_category', 'HR', '{"en":"HR","ru":"Персонал","uk":"Персонал","ar":"الموارد البشرية"}', 90, '{}'),
  ('knowledge_category', 'Procedures', '{"en":"Procedures","ru":"Процедуры","uk":"Процедури","ar":"الإجراءات"}', 100, '{}'),
  ('knowledge_category', 'Training', '{"en":"Training","ru":"Обучение","uk":"Навчання","ar":"التدريب"}', 110, '{}'),
  ('knowledge_category', 'FAQ', '{"en":"FAQ","ru":"FAQ","uk":"FAQ","ar":"الأسئلة الشائعة"}', 120, '{}')
on conflict (kind, code) do nothing;

create or replace function public.class_meta(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select meta from public.taxonomy where kind = 'classification' and code = p_code), '{}'::jsonb)
$$;
grant execute on function public.class_meta(text) to authenticated, service_role;

/* ---------------------------------------------------------------------------------------------
   3. Document numbers: configurable formats, one atomic counter per prefix, never twice
   --------------------------------------------------------------------------------------------- */
create table if not exists public.doc_number_formats (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'document' check (scope in ('document', 'decision', 'knowledge')),
  doc_type text,                                                -- null = any type
  department_key text references public.departments(key) on update cascade on delete restrict, -- null = any
  project_id uuid,                                              -- a project record (records can go to the recycle bin, so no FK)
  company text not null default 'AGR' check (company ~ '^[A-Z0-9]{1,10}$'),
  pattern text not null check (pattern ~ '\{SEQ(:[1-9])?\}' and length(pattern) <= 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists doc_number_formats_scope_idx on public.doc_number_formats (scope) where active;
alter table public.doc_number_formats enable row level security;
revoke all on public.doc_number_formats from anon;
grant select, insert, update on public.doc_number_formats to authenticated;
grant all on public.doc_number_formats to service_role;
drop policy if exists p_numfmt_read on public.doc_number_formats;
create policy p_numfmt_read on public.doc_number_formats for select to authenticated using (not (select public.is_external()));
drop policy if exists p_numfmt_insert on public.doc_number_formats;
create policy p_numfmt_insert on public.doc_number_formats for insert to authenticated with check ((select public.is_admin()));
drop policy if exists p_numfmt_update on public.doc_number_formats;
create policy p_numfmt_update on public.doc_number_formats for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
insert into public.doc_number_formats(scope, pattern)
select s, p from (values ('document', '{CO}-{TYPE}-{SEQ:4}'), ('decision', '{CO}-DEC-{SEQ:4}'), ('knowledge', '{CO}-KB-{SEQ:4}')) v(s, p)
where not exists (select 1 from public.doc_number_formats f where f.scope = v.s and f.doc_type is null and f.department_key is null and f.project_id is null);

create table if not exists public.doc_counters (
  prefix text primary key,
  last integer not null default 0 check (last >= 0),
  updated_at timestamptz not null default now()
);
alter table public.doc_counters enable row level security; -- server only
revoke all on public.doc_counters from anon, authenticated;
grant all on public.doc_counters to service_role;

-- the next number for a record: the most specific active format wins; the counter row is locked by the update
create or replace function public.allocate_doc_number(p_scope text, p_type text, p_dept text, p_project uuid) returns text
language plpgsql security definer set search_path = public as $$
declare f public.doc_number_formats; pre text; n integer; w integer; tcode text; dcode text; pcode text;
begin
  select * into f from public.doc_number_formats x
   where x.active and x.scope = p_scope and (x.doc_type is null or x.doc_type = p_type)
     and (x.department_key is null or x.department_key = p_dept) and (x.project_id is null or x.project_id = p_project)
   order by (x.doc_type is not null)::int + (x.department_key is not null)::int + (x.project_id is not null)::int desc, x.created_at limit 1;
  if not found then return null; end if;
  select upper(coalesce(nullif(meta->>'prefix', ''), left(regexp_replace(coalesce(p_type, 'DOC'), '[^A-Za-z0-9]', '', 'g'), 4))) into tcode from public.taxonomy where kind = 'doc_type' and code = p_type;
  tcode := coalesce(tcode, upper(left(regexp_replace(coalesce(p_type, 'DOC'), '[^A-Za-z0-9]', '', 'g'), 4)), 'DOC');
  select code into dcode from public.departments where key = p_dept; dcode := coalesce(dcode, 'GEN');
  select upper(nullif(regexp_replace(coalesce(data->>'code', ''), '[^A-Za-z0-9]', '', 'g'), '')) into pcode from public.records where id = p_project; pcode := coalesce(pcode, 'GEN');
  pre := replace(replace(replace(replace(replace(f.pattern, '{CO}', f.company), '{TYPE}', tcode), '{DEPT}', dcode), '{PROJ}', pcode), '{YEAR}', to_char(now() at time zone 'utc', 'YYYY'));
  w := coalesce(nullif(substring(pre from '\{SEQ:([1-9])\}'), '')::int, 4);
  insert into public.doc_counters(prefix, last) values (pre, 1)
    on conflict (prefix) do update set last = public.doc_counters.last + 1, updated_at = now()
    returning last into n;
  return regexp_replace(pre, '\{SEQ(:[1-9])?\}', lpad(n::text, w, '0'));
end $$;
revoke execute on function public.allocate_doc_number(text, text, text, uuid) from public, anon, authenticated;

create unique index if not exists records_doc_number_uq on public.records ((data->>'doc_number'))
  where section in ('company.documents', 'company.decisions', 'company.wiki') and data ? 'doc_number';
create index if not exists records_section_updated_idx on public.records (section, updated_at desc);
create index if not exists records_doc_project_idx on public.records ((data->>'project_ref')) where section in ('company.documents', 'company.decisions', 'company.wiki', 'company.meetings', 'company.tasks', 'company.milestones');
create index if not exists records_text_trgm_idx on public.records using gin ((lower(title || ' ' || coalesce(data->>'doc_number', '') || ' ' || coalesce(data->>'description', '') || ' ' || coalesce(data->>'summary', '') || ' ' || coalesce(data->>'body', '') || ' ' || coalesce(data->>'decision', '') || ' ' || coalesce(data->>'notes', '') || ' ' || coalesce(data->>'tags', ''))) extensions.gin_trgm_ops);
create index if not exists records_cal_idx on public.records ((coalesce(data->>'date', data->>'due', data->>'review_due', data->>'expiration_date'))) where section in ('company.meetings', 'company.milestones', 'company.tasks', 'company.documents');

/* ---------------------------------------------------------------------------------------------
   4. Who may see a record: one definition everywhere (RLS, files, discussions, notifications, search, Assistant)
      Adds to v20: restricted classifications, knowledge drafts, decisions follow their source, and announcement
      audiences now also cover the comments and files of the announcement.
   --------------------------------------------------------------------------------------------- */
create or replace function public.extra_visible(p_uid uuid, r public.records) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when r.section = 'company.announcements' then
      exists (select 1 from public.profiles q where q.id = p_uid and q.role in ('owner', 'admin', 'management')) or p_uid = r.created_by
      or (r.status = 'Published' and coalesce(r.data->>'publish_at', '') <= to_char(now() at time zone 'utc', 'YYYY-MM-DD')
          and (coalesce(r.data->>'expires', '') = '' or r.data->>'expires' >= to_char(now() at time zone 'utc', 'YYYY-MM-DD'))
          and p_uid in (select public.announcement_audience(r)))
    when r.section in ('company.documents', 'company.wiki') then
      (not coalesce((public.class_meta(r.data->>'classification')->>'restricted')::boolean, false)
        or p_uid = r.created_by or coalesce(r.data->>'owner_id', '') = p_uid::text or coalesce(r.data->>'reviewer_id', '') = p_uid::text
        or coalesce(r.data->'access_ids', '[]'::jsonb) ? p_uid::text or coalesce(r.data->'contributors_ids', '[]'::jsonb) ? p_uid::text
        or exists (select 1 from public.profiles q where q.id = p_uid and q.role in ('owner', 'management')))
      and (r.section <> 'company.wiki' or coalesce(r.status, 'Published') in ('Published', 'Superseded', 'Archived')
        or p_uid = r.created_by or coalesce(r.data->>'owner_id', '') = p_uid::text or coalesce(r.data->>'reviewer_id', '') = p_uid::text
        or exists (select 1 from public.profiles q where q.id = p_uid and q.role in ('owner', 'admin', 'management')))
    when r.section = 'company.decisions' and coalesce(r.data->>'source_ref', '') ~ '^[0-9a-f-]{36}$' then
      not exists (select 1 from public.records s where s.id = (r.data->>'source_ref')::uuid)
      or exists (select 1 from public.records s where s.id = (r.data->>'source_ref')::uuid and public.record_visible_for(p_uid, s))
    else true end
$$;
revoke execute on function public.extra_visible(uuid, public.records) from public, anon, authenticated;

create or replace function public.record_visible(r public.records) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_read(r.section)
    and (not r.controlled or coalesce((select us_person from public.profiles where id = auth.uid()), false))
    and (not public.is_external() or r.company = '*' or r.company = (select company from public.profiles where id = auth.uid()))
    and public.extra_visible(auth.uid(), r)
$$;
revoke execute on function public.record_visible(public.records) from anon;

create or replace function public.record_visible_for(p_user uuid, r public.records) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_user and not p.disabled
    and (p.role in ('owner', 'admin') or exists (select 1 from public.section_access a where a.role = p.role and a.section = r.section))
    and (not r.controlled or p.us_person)
    and (p.role not in ('partner', 'vendor', 'investor', 'pending') or r.company = '*' or r.company = p.company))
    and public.extra_visible(p_user, r)
$$;
revoke execute on function public.record_visible_for(uuid, public.records) from public, anon, authenticated;

-- announcements: the audience now also matches departments by id, code or name (Phase 3 matched the key only)
create or replace function public.announcement_audience(r public.records) returns setof uuid
language sql stable security definer set search_path = public as $$
  with vals as (select lower(trim(v)) v from unnest(string_to_array(coalesce(r.data->>'audience', ''), ',')) v where trim(v) <> '')
  select p.id from public.profiles p
  where not p.disabled and p.role not in ('partner', 'vendor', 'investor', 'pending')
    and (not r.controlled or p.us_person)
    and case coalesce(r.data->>'audience_type', 'company')
      when 'company' then true
      when 'department' then lower(coalesce(p.department, '')) in (select v from vals)
        or exists (select 1 from public.departments d where d.id = p.department_id and (d.id::text in (select v from vals) or d.key in (select v from vals) or lower(d.code) in (select v from vals) or lower(d.name) in (select v from vals)))
      when 'roles' then lower(p.role) in (select v from vals)
      when 'project' then exists (select 1 from public.records pr where pr.section = 'company.projects'
             and (pr.id::text in (select v from vals) or lower(pr.title) in (select v from vals))
             and (coalesce(pr.data->>'manager_id', '') = p.id::text or coalesce(pr.data->'members_ids', '[]'::jsonb) ? p.id::text))
      else false end
$$;
revoke execute on function public.announcement_audience(public.records) from public, anon, authenticated;

-- files of a controlled or restricted document are opened only through the audited download route
create or replace function public.file_visible(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.records r
    where r.id::text = split_part(path, '/', 2) and r.section = split_part(path, '/', 1) and public.record_visible(r)
      and not (r.section = 'company.documents' and (r.controlled or coalesce((public.class_meta(r.data->>'classification')->>'restricted')::boolean, false))))
$$;
-- a stored version is never replaced or removed through Storage
create or replace function public.file_writable(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.is_external() and exists (select 1 from public.records r
    where r.id::text = split_part(path, '/', 2) and r.section = split_part(path, '/', 1)
      and public.record_visible(r) and public.can_write(r.section))
$$;

/* ---------------------------------------------------------------------------------------------
   5. Document versions: one row per stored file, never changed or removed; hash recorded by the server
   --------------------------------------------------------------------------------------------- */
create table if not exists public.document_versions (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null,            -- the register entry (kept when the entry goes to the recycle bin, so no FK)
  label text not null check (label ~ '^\d{1,3}\.\d{1,3}$'),
  major integer not null, minor integer not null,
  path text not null unique,
  file_name text not null,
  size bigint not null default 0,
  mime text,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  author uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  change_note text check (length(change_note) <= 2000),
  review_state text not null default 'none' check (review_state in ('none', 'in_review', 'reviewed', 'changes_requested')),
  approval_state text not null default 'none' check (approval_state in ('none', 'pending', 'approved', 'rejected', 'changes_requested', 'invalidated')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  effective_date date,
  superseded_at timestamptz,
  verified_at timestamptz,
  verified_ok boolean,
  unique (record_id, label)
);
create index if not exists document_versions_record_idx on public.document_versions (record_id, major desc, minor desc);
alter table public.document_versions enable row level security;
revoke all on public.document_versions from anon;
grant select on public.document_versions to authenticated;
grant all on public.document_versions to service_role;
drop policy if exists p_versions_read on public.document_versions;
create policy p_versions_read on public.document_versions for select to authenticated
  using (exists (select 1 from public.records r where r.id = document_versions.record_id and public.record_visible(r)));
drop policy if exists p_session_document_versions on public.document_versions;
create policy p_session_document_versions on public.document_versions as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));

-- what a version is cannot change: the file, its hash, its number, its author and time
create or replace function public.document_version_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Document versions are kept: a version cannot be deleted' using errcode = '42501'; end if;
  if new.record_id is distinct from old.record_id or new.label is distinct from old.label or new.path is distinct from old.path
     or new.sha256 is distinct from old.sha256 or new.file_name is distinct from old.file_name or new.size is distinct from old.size
     or (new.author is distinct from old.author and new.author is not null) or new.created_at is distinct from old.created_at or new.major is distinct from old.major or new.minor is distinct from old.minor then
    raise exception 'A stored version cannot be changed — upload a new version' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists document_versions_guard on public.document_versions;
create trigger document_versions_guard before update or delete on public.document_versions for each row execute function public.document_version_guard();

-- Storage: a file that is a registered version cannot be deleted through the API (there is no update policy,
-- so a stored file can never be overwritten either)
create or replace function public.file_deletable(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.file_writable(path) and not exists (select 1 from public.document_versions v where v.path = file_deletable.path)
$$;
revoke execute on function public.file_deletable(text) from public, anon;
grant execute on function public.file_deletable(text) to authenticated;
drop policy if exists agron_files_delete on storage.objects;
create policy agron_files_delete on storage.objects for delete to authenticated using (bucket_id = 'files' and public.file_deletable(name));

-- the next version number: minor step by default (0.1 → 0.2, 1.0 → 1.1), or the next major (1.3 → 2.0)
create or replace function public.next_version_label(p_record uuid, p_major boolean) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select case when p_major then (v.major + 1) || '.0' else v.major || '.' || (v.minor + 1) end
    from public.document_versions v where v.record_id = p_record order by v.major desc, v.minor desc limit 1), case when p_major then '1.0' else '0.1' end)
$$;
revoke execute on function public.next_version_label(uuid, boolean) from public, anon;
grant execute on function public.next_version_label(uuid, boolean) to authenticated, service_role;

-- called by the server after it has hashed the stored file; the person's own rights are checked here
create or replace function public.document_version_add(p_actor uuid, p_record uuid, p_path text, p_sha256 text, p_size bigint, p_mime text,
  p_label text default null, p_major boolean default false, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.records; pr public.profiles; lbl text; mj int; mn int; prev public.document_versions; v public.document_versions; inval boolean; u uuid;
begin
  select * into r from public.records where id = p_record and section = 'company.documents' for update;
  if not found then raise exception 'Document not found' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = p_actor;
  if not found or pr.disabled or pr.role in ('partner', 'vendor', 'investor', 'pending') or not public.record_visible_for(p_actor, r)
     or not (pr.role in ('owner', 'admin') or exists (select 1 from public.section_access a where a.role = pr.role and a.section = r.section and a.can_write)) then
    raise exception 'No right to add a version to this document' using errcode = '42501';
  end if;
  if p_path not like 'company.documents/' || r.id || '/%' or p_path ~ '\.\.' then raise exception 'The file must belong to this document' using errcode = '23514'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'files' and o.name = p_path) then raise exception 'File not found' using errcode = '23514'; end if;
  if exists (select 1 from public.document_versions where path = p_path) then raise exception 'This file is already a version' using errcode = '23505'; end if;
  select * into prev from public.document_versions where record_id = r.id order by major desc, minor desc limit 1;
  lbl := coalesce(nullif(trim(p_label), ''), public.next_version_label(r.id, p_major));
  if lbl !~ '^\d{1,3}\.\d{1,3}$' then raise exception 'Version must look like 0.1, 1.0 or 2.3' using errcode = '23514'; end if;
  mj := split_part(lbl, '.', 1)::int; mn := split_part(lbl, '.', 2)::int;
  if prev.id is not null and (mj < prev.major or (mj = prev.major and mn <= prev.minor)) then
    raise exception 'A new version must be higher than %', prev.label using errcode = '23514';
  end if;
  insert into public.document_versions(record_id, label, major, minor, path, file_name, size, mime, sha256, author, change_note)
  values (r.id, lbl, mj, mn, p_path, regexp_replace(split_part(p_path, '/', 3), '^\d+_', ''), coalesce(p_size, 0), p_mime, lower(p_sha256), p_actor, nullif(trim(coalesce(p_note, '')), ''))
  returning * into v;
  -- a pending approval was for the previous version: it no longer applies (unless the document type says otherwise)
  inval := coalesce((select (meta->>'invalidate_on_new_version')::boolean from public.taxonomy where kind = 'doc_type' and code = r.data->>'doc_type'), true);
  if inval then
    update public.approvals set status = 'cancelled', comment = coalesce(comment, 'Superseded by version ' || lbl)
     where record_id = r.id and status in ('pending', 'queued') and (version_id is null or version_id <> v.id);
    update public.document_versions set approval_state = 'invalidated' where record_id = r.id and id <> v.id and approval_state = 'pending';
  end if;
  update public.records set data = data || jsonb_build_object('version', lbl, 'current_version_id', v.id),
         status = case when status in ('Approved', 'Effective', 'Changes requested') then 'Draft' else status end
   where id = r.id;
  insert into public.activity(record_id, section, actor, action, detail) values (r.id, r.section, p_actor, 'version_added',
    jsonb_build_object('version', lbl, 'version_id', v.id, 'sha256', v.sha256, 'size', v.size, 'previous', prev.label));
  for u in select distinct x from (select nullif(r.data->>'owner_id', '')::uuid x union select r.created_by union select nullif(r.data->>'reviewer_id', '')::uuid
      union select nullif(p.data->>'manager_id', '')::uuid from public.records p where p.id::text = r.data->>'project_ref') s where x is not null loop
    perform public.notify_user(u, 'doc_version', r.id, 'ver:' || v.id || ':' || u, r.title, 'Version ' || lbl, p_actor);
  end loop;
  return to_jsonb(v);
end $$;
revoke execute on function public.document_version_add(uuid, uuid, text, text, bigint, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.document_version_add(uuid, uuid, text, text, bigint, text, text, boolean, text) to service_role;

-- integrity check result (the server recomputes the hash of the stored file)
create or replace function public.document_version_verified(p_actor uuid, p_version uuid, p_ok boolean, p_found text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.document_versions;
begin
  update public.document_versions set verified_at = now(), verified_ok = p_ok where id = p_version returning * into v;
  insert into public.activity(record_id, section, actor, action, detail) values (v.record_id, 'company.documents', p_actor, 'integrity_check',
    jsonb_build_object('version', v.label, 'version_id', v.id, 'ok', p_ok, 'expected', v.sha256, 'found', p_found));
end $$;
revoke execute on function public.document_version_verified(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.document_version_verified(uuid, uuid, boolean, text) to service_role;

/* ---------------------------------------------------------------------------------------------
   6. Approval of an exact version: sequential or parallel chains on the existing approvals
   --------------------------------------------------------------------------------------------- */
alter table public.approvals add column if not exists version_id uuid references public.document_versions(id) on delete restrict;
alter table public.approvals add column if not exists chain_id uuid;
alter table public.approvals add column if not exists step integer not null default 1;
alter table public.approvals add column if not exists chain_mode text not null default 'single';
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.approvals'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.approvals drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'approvals_chain_mode_check') then
    alter table public.approvals add constraint approvals_chain_mode_check check (chain_mode in ('single', 'sequential', 'all'));
  end if;
end $$;
alter table public.approvals add constraint approvals_status_check check (status in ('queued', 'pending', 'approved', 'rejected', 'changes_requested', 'cancelled', 'expired'));
create index if not exists approvals_chain_idx on public.approvals (chain_id, step) where chain_id is not null;
create index if not exists approvals_version_idx on public.approvals (version_id) where version_id is not null;

-- a queued step is not a request yet: the approver hears about it when it becomes theirs
create or replace function public.approvals_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  select title into t from public.records where id = new.record_id;
  if (tg_op = 'INSERT' and new.status = 'pending') or (tg_op = 'UPDATE' and old.status = 'queued' and new.status = 'pending') then
    perform public.notify_user(new.approver_id, 'approval_requested', new.record_id, 'appr:' || new.id, t, new.note, new.requested_by);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'rejected', 'changes_requested') then
    perform public.notify_user(new.requested_by, 'approval_done', new.record_id, 'appr:' || new.id || ':' || new.status, t,
      new.status || coalesce(': ' || new.comment, ''), coalesce(new.decided_by, new.approver_id));
  end if;
  return null;
end $$;
revoke execute on function public.approvals_notify() from public, anon, authenticated;

-- the outcome of an approval for its version (called by the approvals route with the service role)
create or replace function public.document_version_decided(p_version uuid, p_state text, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.document_versions; r public.records;
begin
  if p_state not in ('pending', 'approved', 'rejected', 'changes_requested') then raise exception 'Unknown state'; end if;
  update public.document_versions set approval_state = p_state,
         approved_by = case when p_state = 'approved' then p_by else approved_by end,
         approved_at = case when p_state = 'approved' then now() else approved_at end
   where id = p_version returning * into v;
  if not found then return; end if;
  select * into r from public.records where id = v.record_id;
  if p_state = 'approved' then
    update public.records set data = data || jsonb_build_object('approved_version_id', v.id, 'approved_version', v.label) where id = v.record_id;
    insert into public.activity(record_id, section, actor, action, detail) values (v.record_id, 'company.documents', p_by, 'version_approved', jsonb_build_object('version', v.label, 'version_id', v.id, 'sha256', v.sha256));
  elsif p_state in ('rejected', 'changes_requested') then
    insert into public.activity(record_id, section, actor, action, detail) values (v.record_id, 'company.documents', p_by, 'version_' || p_state, jsonb_build_object('version', v.label, 'version_id', v.id));
  end if;
end $$;
revoke execute on function public.document_version_decided(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.document_version_decided(uuid, text, uuid) to service_role;

-- the reviewer's verdict on the current version (before or beside approval)
create or replace function public.document_review(p_record uuid, p_decision text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r public.records; me uuid := auth.uid(); v public.document_versions;
begin
  if p_decision not in ('reviewed', 'changes_requested') then raise exception 'Choose reviewed or changes requested'; end if;
  select * into r from public.records where id = p_record and section = 'company.documents';
  if not found or me is null or not public.record_visible(r) or not public.session_ok() then raise exception 'Document not found' using errcode = '42501'; end if;
  if coalesce(r.data->>'reviewer_id', '') <> me::text and not exists (select 1 from public.profiles p where p.id = me and p.role in ('owner', 'admin', 'management')) then
    raise exception 'Only the reviewer of this document can give the review' using errcode = '42501';
  end if;
  if p_decision = 'changes_requested' and length(trim(coalesce(p_note, ''))) = 0 then raise exception 'Say what needs to change' using errcode = '23514'; end if;
  select * into v from public.document_versions where id::text = r.data->>'current_version_id';
  if v.id is null then raise exception 'Upload a version first' using errcode = '23514'; end if;
  update public.document_versions set review_state = p_decision where id = v.id;
  perform set_config('agron.doc_service', 'on', true);
  update public.records set status = case when p_decision = 'changes_requested' then 'Changes requested' else status end,
         data = data || jsonb_build_object('reviewed_version', v.label, 'reviewed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD')) where id = r.id;
  perform set_config('agron.doc_service', '', true);
  if p_note is not null and length(trim(p_note)) > 0 then
    insert into public.comments(record_id, author, body, kind, file_path, version_label) values (r.id, me, p_note, 'review', v.path, 'V' || v.label);
  end if;
  insert into public.activity(record_id, section, actor, action, detail) values (r.id, r.section, me, 'review_' || p_decision, jsonb_build_object('version', v.label, 'version_id', v.id));
  perform public.notify_user(coalesce(nullif(r.data->>'owner_id', '')::uuid, r.created_by), case when p_decision = 'reviewed' then 'review_done' else 'review_changes' end, r.id,
    'review:' || v.id || ':' || p_decision, r.title, 'Version ' || v.label || coalesce(': ' || nullif(trim(p_note), ''), ''), me);
  return p_decision;
end $$;
revoke execute on function public.document_review(uuid, text, text) from public, anon;
grant execute on function public.document_review(uuid, text, text) to authenticated;

/* ---------------------------------------------------------------------------------------------
   7. Register rules on save: numbers, classification, lifecycle, protected fields (documents, knowledge,
      decisions, meeting minutes)
   --------------------------------------------------------------------------------------------- */
create or replace function public.records_doc_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my_role text; d jsonb; od jsonb; cm jsonb; states jsonb; lead boolean; svc boolean; owner_ok boolean; k text; scope text;
begin
  if new.section not in ('company.documents', 'company.wiki', 'company.decisions', 'company.meetings') then return new; end if;
  d := coalesce(new.data, '{}'::jsonb); od := case when tg_op = 'UPDATE' then coalesce(old.data, '{}'::jsonb) else '{}'::jsonb end;
  svc := me is null or coalesce(current_setting('agron.doc_service', true), '') = 'on';
  if me is not null then select role into my_role from public.profiles where id = me; end if;
  lead := svc or coalesce(my_role, '') in ('owner', 'admin', 'management');

  if new.section = 'company.meetings' then
    -- the meeting record (minutes) is approved only by its owner through meeting_minutes_approve
    if not svc then
      foreach k in array array['minutes_state', 'minutes_approved_by', 'minutes_approved_at'] loop
        if od ? k then d := jsonb_set(d, array[k], od->k); else d := d - k; end if;
      end loop;
      if coalesce(od->>'minutes_state', '') = 'approved' and d->>'minutes' is distinct from od->>'minutes' then
        d := d || '{"minutes_state":"draft"}'::jsonb - 'minutes_approved_by' - 'minutes_approved_at';
      end if;
    end if;
    new.data := d; return new;
  end if;

  -- numbers are given by the database once and never change
  scope := case new.section when 'company.documents' then 'document' when 'company.decisions' then 'decision' else 'knowledge' end;
  if tg_op = 'UPDATE' and od ? 'doc_number' then d := jsonb_set(d, '{doc_number}', od->'doc_number');
  elsif tg_op = 'UPDATE' and not (od ? 'doc_number') and not svc then d := d - 'doc_number';
  elsif tg_op = 'INSERT' and not (svc and d ? 'doc_number') then
    d := d - 'doc_number';
    k := public.allocate_doc_number(scope, d->>'doc_type', nullif(d->>'department', ''), case when coalesce(d->>'project_ref', '') ~ '^[0-9a-f-]{36}$' then (d->>'project_ref')::uuid end);
    if k is not null then d := d || jsonb_build_object('doc_number', k); end if;
  end if;
  if new.section = 'company.decisions' then
    if tg_op = 'INSERT' and coalesce(d->>'made_by_id', '') = '' and me is not null then d := d || jsonb_build_object('made_by_id', me); end if;
    new.data := d; return new;
  end if;

  -- fields only the server sets: version pointers and approval results
  if not svc then
    foreach k in array array['current_version_id', 'approved_version_id', 'approved_version', 'reviewed_version', 'reviewed_at', 'superseded_by', 'version'] loop
      if od ? k then d := jsonb_set(d, array[k], od->k); else d := d - k; end if;
    end loop;
  end if;

  -- classification: chosen explicitly by an authorized person; never inferred
  owner_ok := lead or (tg_op = 'INSERT') or me = old.created_by or coalesce(od->>'owner_id', '') = me::text;
  if tg_op = 'INSERT' and coalesce(d->>'classification', '') = '' then d := d || jsonb_build_object('classification', case when new.controlled then 'US Persons Only' else 'Internal' end); end if;
  if tg_op = 'UPDATE' and d->>'classification' is distinct from od->>'classification' and not owner_ok then
    raise exception 'Only the owner of the document or management can change its classification' using errcode = '42501';
  end if;
  if not exists (select 1 from public.taxonomy t where t.kind = 'classification' and t.code = d->>'classification' and t.active) then
    raise exception 'Unknown classification: %', d->>'classification' using errcode = '23514';
  end if;
  cm := public.class_meta(d->>'classification');
  if coalesce((cm->>'us_only')::boolean, false) then new.controlled := true;
  elsif tg_op = 'UPDATE' and od->>'classification' is distinct from d->>'classification' and coalesce((public.class_meta(od->>'classification')->>'us_only')::boolean, false) then new.controlled := false;
  end if;
  if new.controlled and coalesce(d->>'classification', '') <> 'US Persons Only' and not coalesce((cm->>'us_only')::boolean, false) and tg_op = 'INSERT' then
    d := d || '{"classification":"US Persons Only"}'::jsonb;
  end if;
  if coalesce((cm->>'no_external')::boolean, false) and new.company is not null then
    raise exception 'A % document cannot be shared outside the company', d->>'classification' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and d->>'classification' is distinct from od->>'classification' then
    insert into public.activity(record_id, section, actor, action, detail) values (new.id, new.section, me, 'classification', jsonb_build_object('from', od->>'classification', 'to', d->>'classification'));
  end if;

  -- lifecycle by document type: allowed states, and the steps only the system or a lead may take
  if new.section = 'company.documents' then
    states := (select meta->'states' from public.taxonomy where kind = 'doc_type' and code = d->>'doc_type');
    if jsonb_typeof(states) = 'array' and not (states ? coalesce(new.status, '')) then
      raise exception 'Status % is not used for %', new.status, d->>'doc_type' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status and not svc then
      if new.status = 'Approved' then raise exception 'A document becomes Approved only through its approval' using errcode = '42501'; end if;
      if new.status = 'Changes requested' then raise exception 'Changes are requested by the reviewer or the approver' using errcode = '42501'; end if;
      if new.status = 'In review' and coalesce(d->>'current_version_id', '') = '' then raise exception 'Upload a version before sending it for review' using errcode = '23514'; end if;
      if new.status = 'Effective' then
        if coalesce(d->>'approved_version_id', '') = '' or d->>'approved_version_id' is distinct from d->>'current_version_id' then
          raise exception 'Only the approved current version can become effective' using errcode = '23514';
        end if;
        if not (lead or me = old.created_by or coalesce(od->>'owner_id', '') = me::text) then raise exception 'Only the owner or management can make a document effective' using errcode = '42501'; end if;
        if coalesce(d->>'effective_date', '') = '' then d := d || jsonb_build_object('effective_date', to_char(now() at time zone 'utc', 'YYYY-MM-DD')); end if;
        update public.document_versions set effective_date = (d->>'effective_date')::date where id::text = d->>'current_version_id' and effective_date is null;
        update public.document_versions set superseded_at = now() where record_id = new.id and id::text <> d->>'current_version_id' and superseded_at is null and approval_state = 'approved';
      end if;
      if new.status in ('Superseded', 'Archived') and not (lead or me = old.created_by or coalesce(od->>'owner_id', '') = me::text) then
        raise exception 'Only the owner or management can supersede or archive a document' using errcode = '42501';
      end if;
    end if;
    if tg_op = 'INSERT' and new.status in ('Approved', 'Effective', 'Changes requested') and not svc then new.status := 'Draft'; end if;
  else -- knowledge
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('Published', 'Superseded') and not svc
       and not (lead or coalesce(d->>'reviewer_id', '') = me::text) then
      raise exception 'A knowledge article is published by its reviewer or management' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and new.status in ('Published', 'Superseded') and not lead then new.status := 'Draft'; end if;
    if new.status = 'Published' and (tg_op = 'INSERT' or old.status is distinct from 'Published') then
      d := d || jsonb_build_object('last_reviewed', to_char(now() at time zone 'utc', 'YYYY-MM-DD'));
    end if;
  end if;
  new.data := d;
  return new;
end $$;
revoke execute on function public.records_doc_rules() from public, anon, authenticated;
drop trigger if exists records_doc_rules on public.records;
create trigger records_doc_rules before insert or update on public.records for each row execute function public.records_doc_rules();

-- after save: a published knowledge article or an effective document supersedes the one it replaces;
-- a reviewer who is named is asked for the review
create or replace function public.records_doc_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb := coalesce(new.data, '{}'::jsonb); od jsonb := case when tg_op = 'UPDATE' then coalesce(old.data, '{}'::jsonb) else '{}'::jsonb end;
begin
  if new.section not in ('company.documents', 'company.wiki') then return null; end if;
  if coalesce(d->>'supersedes', d->>'supersedes_ref', '') ~ '^[0-9a-f-]{36}$'
     and ((new.section = 'company.wiki' and new.status = 'Published') or (new.section = 'company.documents' and new.status = 'Effective'))
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform set_config('agron.doc_service', 'on', true);
    update public.records set status = 'Superseded', data = data || jsonb_build_object('superseded_by', new.id)
     where id = coalesce(nullif(d->>'supersedes', ''), d->>'supersedes_ref')::uuid and section = new.section and status is distinct from 'Superseded';
    perform set_config('agron.doc_service', '', true);
    insert into public.activity(record_id, section, actor, action, detail) values (new.id, new.section, auth.uid(), 'supersedes', jsonb_build_object('previous', coalesce(nullif(d->>'supersedes', ''), d->>'supersedes_ref')));
  end if;
  if coalesce(d->>'reviewer_id', '') ~ '^[0-9a-f-]{36}$' and (d->>'reviewer_id' is distinct from od->>'reviewer_id' or (new.status in ('In review', 'Review') and (tg_op = 'INSERT' or old.status is distinct from new.status))) then
    perform public.notify_user((d->>'reviewer_id')::uuid, 'review_request', new.id, 'reviewreq:' || new.id || ':' || (d->>'reviewer_id') || ':' || coalesce(d->>'version', '') || ':' || coalesce(new.status, ''),
      new.title, coalesce('Version ' || (d->>'version'), '') || coalesce(' · due ' || (d->>'review_due'), ''), auth.uid());
  end if;
  return null;
end $$;
revoke execute on function public.records_doc_after() from public, anon, authenticated;
drop trigger if exists records_doc_after on public.records;
create trigger records_doc_after after insert or update on public.records for each row execute function public.records_doc_after();

-- existing register entries: classification from the controlled flag, a number for each (oldest first);
-- nothing else is changed and no entry is removed
update public.records set data = data || jsonb_build_object('classification', case when controlled then 'US Persons Only' else 'Internal' end)
 where section in ('company.documents', 'company.wiki') and coalesce(data->>'classification', '') = '';
do $$ declare r record; n text; begin
  for r in select id, section, data from public.records where section in ('company.documents', 'company.decisions', 'company.wiki') and not (data ? 'doc_number') order by created_at loop
    n := public.allocate_doc_number(case r.section when 'company.documents' then 'document' when 'company.decisions' then 'decision' else 'knowledge' end,
      r.data->>'doc_type', nullif(r.data->>'department', ''), case when coalesce(r.data->>'project_ref', '') ~ '^[0-9a-f-]{36}$' then (r.data->>'project_ref')::uuid end);
    perform set_config('agron.doc_service', 'on', true);
    update public.records set data = data || jsonb_build_object('doc_number', n, '_v21_number', true) where id = r.id;
  end loop;
  perform set_config('agron.doc_service', '', true);
end $$;

-- meeting minutes become the corporate record only when the meeting owner approves them
create or replace function public.meeting_minutes_approve(p_meeting uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.records; me uuid := auth.uid();
begin
  select * into m from public.records where id = p_meeting and section = 'company.meetings';
  if not found or me is null or not public.record_visible(m) or not public.session_ok() then raise exception 'Meeting not found' using errcode = '42501'; end if;
  if not (m.created_by = me or coalesce(m.data->>'organizer_id', '') = me::text or exists (select 1 from public.profiles p where p.id = me and p.role in ('owner', 'admin', 'management'))) then
    raise exception 'Only the meeting owner can approve the meeting record' using errcode = '42501';
  end if;
  if length(trim(coalesce(m.data->>'minutes', ''))) = 0 then raise exception 'Generate the meeting record first' using errcode = '23514'; end if;
  perform set_config('agron.doc_service', 'on', true);
  update public.records set data = data || jsonb_build_object('minutes_state', 'approved', 'minutes_approved_by', me, 'minutes_approved_at', now()) where id = m.id;
  perform set_config('agron.doc_service', '', true);
  insert into public.activity(record_id, section, actor, action, detail) values (m.id, m.section, me, 'minutes_approved', jsonb_build_object('length', length(m.data->>'minutes')));
  return jsonb_build_object('state', 'approved', 'by', me);
end $$;
revoke execute on function public.meeting_minutes_approve(uuid) from public, anon;
grant execute on function public.meeting_minutes_approve(uuid) to authenticated;

/* ---------------------------------------------------------------------------------------------
   8. Download audit: who opened which version, allowed or refused — never the content
   --------------------------------------------------------------------------------------------- */
create table if not exists public.document_access_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete set null,
  record_id uuid,
  version_id uuid,
  path text,
  action text not null check (action in ('download', 'preview', 'verify')),
  ok boolean not null,
  reason text check (length(reason) <= 300),
  ip text check (length(ip) <= 80),
  user_agent text check (length(user_agent) <= 300)
);
create index if not exists document_access_log_record_idx on public.document_access_log (record_id, at desc);
create index if not exists document_access_log_user_idx on public.document_access_log (user_id, at desc);
alter table public.document_access_log enable row level security;
revoke all on public.document_access_log from anon;
grant select on public.document_access_log to authenticated;
grant all on public.document_access_log to service_role;
grant usage on sequence public.document_access_log_id_seq to service_role;
-- owners, administrators and management read the log; nobody changes it through the API
drop policy if exists p_doclog_read on public.document_access_log;
create policy p_doclog_read on public.document_access_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('owner', 'admin', 'management')));
drop policy if exists p_session_document_access_log on public.document_access_log;
create policy p_session_document_access_log on public.document_access_log as restrictive for all to authenticated using ((select public.session_ok())) with check ((select public.session_ok()));

/* ---------------------------------------------------------------------------------------------
   9. Fast lists that keep the same access rules. The Document Center resolves the viewer once and applies the same
      conditions record_visible applies (section access, US persons, company, restricted classification); the tests
      check it returns exactly what direct reading returns. Search and calendar pass each candidate through record_visible.
   --------------------------------------------------------------------------------------------- */
create or replace function public.document_center(p_view text default 'all', p_q text default null, p_project uuid default null, p_department text default null,
  p_owner uuid default null, p_type text default null, p_status text default null, p_approval text default null, p_classification text default null,
  p_from date default null, p_to date default null, p_version text default null, p_sort text default 'updated', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); pr public.profiles; secs text[]; adm boolean; ext boolean; restricted text[]; q text := lower(trim(coalesce(p_q, ''))); res jsonb;
begin
  if me is null or not public.session_ok() then return jsonb_build_object('total', 0, 'rows', '[]'::jsonb); end if;
  select * into pr from public.profiles where id = me and not disabled;
  if not found then return jsonb_build_object('total', 0, 'rows', '[]'::jsonb); end if;
  adm := pr.role in ('owner', 'admin'); ext := pr.role in ('partner', 'vendor', 'investor', 'pending');
  if not adm and not exists (select 1 from public.section_access a where a.role = pr.role and a.section = 'company.documents') then return jsonb_build_object('total', 0, 'rows', '[]'::jsonb); end if;
  select coalesce(array_agg(code), '{}') into restricted from public.taxonomy where kind = 'classification' and coalesce((meta->>'restricted')::boolean, false);
  with base as (
    select r.* from public.records r
    where r.section = 'company.documents'
      -- the same rules as record_visible, with the viewer resolved once (checked against RLS in the tests)
      and (not r.controlled or pr.us_person) and (not ext or r.company = '*' or r.company = pr.company)
      and (not (r.data->>'classification' = any(restricted)) or me = r.created_by or r.data->>'owner_id' = me::text or r.data->>'reviewer_id' = me::text
           or coalesce(r.data->'access_ids', '[]'::jsonb) ? me::text or coalesce(r.data->'contributors_ids', '[]'::jsonb) ? me::text or pr.role in ('owner', 'management'))
      and (q = '' or lower(r.title || ' ' || coalesce(r.data->>'doc_number', '') || ' ' || coalesce(r.data->>'description', '') || ' ' || coalesce(r.data->>'summary', '') || ' ' || coalesce(r.data->>'body', '') || ' ' || coalesce(r.data->>'decision', '') || ' ' || coalesce(r.data->>'notes', '') || ' ' || coalesce(r.data->>'tags', '')) like '%' || replace(replace(q, '%', '\%'), '_', '\_') || '%')
      and (p_project is null or r.data->>'project_ref' = p_project::text)
      and (p_department is null or r.data->>'department' = p_department)
      and (p_owner is null or r.data->>'owner_id' = p_owner::text)
      and (p_type is null or r.data->>'doc_type' = p_type)
      and (p_status is null or r.status = p_status)
      and (p_classification is null or r.data->>'classification' = p_classification)
      and (p_version is null or r.data->>'version' = p_version)
      and (p_from is null or r.updated_at >= p_from) and (p_to is null or r.updated_at < p_to + 1)
      and case coalesce(p_view, 'all')
        when 'mine' then r.created_by = me or r.data->>'owner_id' = me::text
        when 'recent' then r.updated_at > now() - interval '30 days'
        when 'shared' then r.created_by is distinct from me and (coalesce(r.data->'access_ids', '[]'::jsonb) ? me::text or coalesce(r.data->'contributors_ids', '[]'::jsonb) ? me::text or r.data->>'reviewer_id' = me::text)
        when 'review' then r.data->>'reviewer_id' = me::text and r.status = 'In review'
        when 'approval' then exists (select 1 from public.approvals a where a.record_id = r.id and a.approver_id = me and a.status = 'pending')
        when 'controlled' then r.controlled or r.data->>'classification' = any(restricted)
        when 'archived' then r.status in ('Archived', 'Superseded')
        else r.status is distinct from 'Archived' end
  ), filt as (
    select b.*, case when p_approval is null then null else coalesce((select a.status from public.approvals a where a.record_id = b.id and a.status in ('pending', 'queued') order by a.created_at desc limit 1),
           (select dv.approval_state from public.document_versions dv where dv.id::text = b.data->>'current_version_id'), 'none') end ap
    from base b
  ), sel as (select f.* from filt f where p_approval is null or f.ap = p_approval),
  page as (select s.* from sel s
    order by case when p_sort = 'number' then s.data->>'doc_number' when p_sort = 'title' then lower(s.title) end nulls last, case when p_sort in ('number', 'title') then null else s.updated_at end desc nulls last
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0))
  select jsonb_build_object('total', (select count(*) from sel),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'doc_number', v.data->>'doc_number', 'title', v.title, 'doc_type', v.data->>'doc_type',
        'project_ref', v.data->>'project_ref', 'project', v.data->>'project_ref_title', 'department', v.data->>'department', 'owner_id', v.data->>'owner_id', 'owner', v.data->>'owner',
        'version', v.data->>'version', 'approved_version', v.data->>'approved_version', 'status', v.status, 'classification', v.data->>'classification', 'controlled', v.controlled,
        'updated_at', v.updated_at, 'approval', coalesce(v.ap, (select a.status from public.approvals a where a.record_id = v.id and a.status in ('pending', 'queued') order by a.created_at desc limit 1),
           (select dv.approval_state from public.document_versions dv where dv.id::text = v.data->>'current_version_id'), 'none'))
        order by case when p_sort = 'number' then v.data->>'doc_number' when p_sort = 'title' then lower(v.title) end nulls last, case when p_sort in ('number', 'title') then null else v.updated_at end desc nulls last)
      from page v), '[]'::jsonb)) into res;
  return res;
end $$;
revoke execute on function public.document_center(text, text, uuid, text, uuid, text, text, text, text, date, date, text, text, integer, integer) from public, anon;
grant execute on function public.document_center(text, text, uuid, text, uuid, text, text, text, text, date, date, text, text, integer, integer) to authenticated;

-- one search over authorized information: register entries, knowledge, projects, tasks, meetings, decisions,
-- announcements, text inside stored documents, discussions and people
create or replace function public.corp_search(p_q text, p_types text[] default null, p_project uuid default null, p_department text default null, p_person uuid default null,
  p_doc_type text default null, p_from date default null, p_to date default null, p_classification text default null, p_status text default null, p_limit integer default 40)
returns table (kind text, id uuid, record_id uuid, section text, title text, excerpt text, project_ref text, version text, owner_id text, updated_at timestamptz, link text, rank real)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid := auth.uid(); pr public.profiles; q text := lower(trim(coalesce(p_q, ''))); w1 text; tsq tsquery; lim integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  sec_kind jsonb := '{"company.documents":"document","company.wiki":"knowledge","company.projects":"project","company.tasks":"task","company.meetings":"meeting","company.decisions":"decision","company.announcements":"announcement","company.milestones":"milestone"}';
begin
  if me is null or not public.session_ok() or length(q) < 2 then return; end if;
  select * into pr from public.profiles where id = me and not disabled; if not found then return; end if;
  w1 := replace(replace(replace(split_part(q, ' ', 1), '\', '\\'), '%', '\%'), '_', '\_');
  begin tsq := plainto_tsquery('simple', q); exception when others then tsq := null; end;
  return query
  with rec as (
    select r.*, sec_kind->>r.section k from public.records r
    where lower(r.title || ' ' || coalesce(r.data->>'doc_number', '') || ' ' || coalesce(r.data->>'description', '') || ' ' || coalesce(r.data->>'summary', '') || ' ' || coalesce(r.data->>'body', '') || ' ' || coalesce(r.data->>'decision', '') || ' ' || coalesce(r.data->>'notes', '') || ' ' || coalesce(r.data->>'tags', '')) like '%' || w1 || '%'
      and (p_types is null or (sec_kind->>r.section) = any(p_types) or (r.section not in (select jsonb_object_keys(sec_kind)) and 'record' = any(p_types)))
      and (p_project is null or r.id = p_project or r.data->>'project_ref' = p_project::text)
      and (p_department is null or r.data->>'department' = p_department)
      and (p_person is null or r.created_by = p_person or p_person::text in (r.data->>'owner_id', r.data->>'assignee_id', r.data->>'organizer_id', r.data->>'manager_id', r.data->>'made_by_id', r.data->>'responsible_id'))
      and (p_doc_type is null or r.data->>'doc_type' = p_doc_type)
      and (p_classification is null or r.data->>'classification' = p_classification)
      and (p_status is null or r.status = p_status)
      and (p_from is null or r.updated_at >= p_from) and (p_to is null or r.updated_at < p_to + 1)
      -- knowledge: the current article, not the one it replaced (unless asked for that status)
      and (r.section <> 'company.wiki' or p_status is not null or coalesce(r.status, 'Published') not in ('Superseded', 'Archived'))
    order by (lower(r.title) like '%' || q || '%') desc, r.updated_at desc
    limit 400
  ), recv as (select x.* from rec x join public.records rr on rr.id = x.id where public.record_visible(rr)
      and not exists (select 1 from unnest(string_to_array(q, ' ')) w where w <> '' and position(w in lower(x.title || ' ' || coalesce(x.data::text, ''))) = 0)
    limit lim),
  pages as (
    select p.record_id, p.path, p.page, p.content, ts_rank(p.tsv, tsq) rk, r2.title rtitle, r2.section rsection, r2.data rdata, r2.updated_at rupd
    from public.doc_pages p join public.records r2 on r2.id = p.record_id
    where tsq is not null and (p_types is null or 'document_text' = any(p_types) or 'document' = any(p_types)) and p.tsv @@ tsq
      and (p_project is null or r2.data->>'project_ref' = p_project::text) and (p_doc_type is null or r2.data->>'doc_type' = p_doc_type)
      and (p_classification is null or r2.data->>'classification' = p_classification) and public.record_visible(r2)
    order by rk desc limit lim
  )
  select coalesce(x.k, 'record'), x.id, x.id, x.section, x.title,
         left(coalesce(nullif(x.data->>'summary', ''), nullif(x.data->>'description', ''), nullif(left(regexp_replace(coalesce(x.data->>'body', x.data->>'decision', x.data->>'notes', ''), '[#*_>`]', '', 'g'), 220), ''), x.data->>'doc_type', x.status, ''), 220),
         coalesce(case when x.section = 'company.projects' then x.id::text end, x.data->>'project_ref'), x.data->>'version',
         coalesce(x.data->>'owner_id', x.data->>'assignee_id', x.data->>'organizer_id', x.data->>'manager_id', x.created_by::text), x.updated_at,
         case when x.section = 'company.projects' then '/projects/' || x.id when x.section = 'company.documents' then '/documents?d=' || x.id when x.section = 'company.wiki' then '/knowledge?a=' || x.id
              else '/' || replace(x.section, '.', '/') || '?r=' || x.id end,
         (case when lower(x.title) like '%' || q || '%' then 2 else 1 end)::real
  from recv x
  union all
  select 'document_text', pg.record_id, pg.record_id, pg.rsection, pg.rtitle,
         left(ts_headline('simple', pg.content, tsq, 'MaxWords=30, MinWords=12, StartSel=«, StopSel=», MaxFragments=1'), 260),
         pg.rdata->>'project_ref', pg.rdata->>'version', pg.rdata->>'owner_id', pg.rupd,
         case when pg.rsection = 'company.documents' then '/documents?d=' || pg.record_id else '/' || replace(pg.rsection, '.', '/') || '?r=' || pg.record_id end || '&page=' || pg.page, pg.rk
  from pages pg
  union all
  select 'discussion', m.id, m.record_id, m.section, m.title, m.excerpt, m.project_ref, null, m.author::text, m.created_at,
         case when m.section = 'company.projects' then '/projects/' || m.record_id || '?tab=discussion#c-' || m.id else '/' || replace(m.section, '.', '/') || '?r=' || m.record_id || '#c-' || m.id end, 0.5::real
  from public.search_messages(p_q, p_project, p_person, p_from, p_to, null, false, false, lim) m
  where p_types is null or 'discussion' = any(p_types)
  union all
  select 'person', p.id, null, null, coalesce(nullif(p.full_name, ''), p.email), concat_ws(' · ', p.title, d.name), null, null, null, null, '/people?q=' || coalesce(nullif(p.full_name, ''), p.email), 0.8::real
  from public.profiles p left join public.departments d on d.id = p.department_id
  where (p_types is null or 'person' = any(p_types)) and pr.role not in ('partner', 'vendor', 'investor', 'pending')
    and not p.disabled and p.role not in ('partner', 'vendor', 'investor', 'pending')
    and lower(coalesce(p.full_name, '') || ' ' || p.email || ' ' || coalesce(p.title, '') || ' ' || coalesce(d.name, '')) like '%' || w1 || '%'
    and (p_department is null or p.department = p_department)
  order by 12 desc
  limit lim * 3;
end $$;
revoke execute on function public.corp_search(text, text[], uuid, text, uuid, text, date, date, text, text, integer) from public, anon;
grant execute on function public.corp_search(text, text[], uuid, text, uuid, text, date, date, text, text, integer) to authenticated;

-- calendar: meetings (with weekly / every-two-weeks / monthly repeats), milestones, my task deadlines, review and expiry
-- dates of documents, approvals waiting for me — each only if the person may open the source
create or replace function public.calendar_items(p_from date, p_to date, p_scope text default 'mine') returns table (kind text, record_id uuid, title text, day date, at_time text, tz text, status text, project_ref text, link text, meta jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare me uuid := auth.uid(); pr public.profiles; f text := to_char(p_from, 'YYYY-MM-DD'); t text := to_char(p_to, 'YYYY-MM-DD');
begin
  if me is null or not public.session_ok() or p_to < p_from or p_to - p_from > 400 then return; end if;
  select * into pr from public.profiles where id = me and not disabled; if not found then return; end if;
  return query
  with mt as (
    select r.* from public.records r where r.section = 'company.meetings' and coalesce(r.data->>'date', '') ~ '^\d{4}-\d{2}-\d{2}'
      and left(r.data->>'date', 10) <= t and (coalesce(r.data->>'recurrence', 'none') <> 'none' or left(r.data->>'date', 10) >= f)
      and (p_scope = 'all' or r.created_by = me or r.data->>'organizer_id' = me::text or coalesce(r.data->'participants_ids', '[]'::jsonb) ? me::text)
      and public.record_visible(r)
  ), occ as (
    select m.*, g::date d from mt m,
      generate_series(left(m.data->>'date', 10)::date,
        least(p_to, coalesce(nullif(m.data->>'recurrence_until', '')::date, p_to)),
        case m.data->>'recurrence' when 'weekly' then interval '7 days' when 'biweekly' then interval '14 days' when 'monthly' then interval '1 month' else interval '100 years' end) g
    where g::date >= p_from
  ), other as (
    select r.*, left(coalesce(case r.section when 'company.documents' then coalesce(r.data->>'review_due', r.data->>'expiration_date') else r.data->>'due' end, ''), 10) d1 from public.records r
    where r.section in ('company.milestones', 'company.tasks', 'company.documents')
      and coalesce(r.data->>'date', r.data->>'due', r.data->>'review_due', r.data->>'expiration_date') between f and t || 'z'
      and (r.section <> 'company.tasks' or ((p_scope = 'all' or r.data->>'assignee_id' = me::text or r.created_by = me) and coalesce(r.status, '') not in ('Completed', 'Cancelled')))
      and (r.section <> 'company.documents' or p_scope = 'all' or r.data->>'owner_id' = me::text or r.data->>'reviewer_id' = me::text or r.created_by = me)
      and public.record_visible(r)
  )
  select 'meeting', o.id, o.title, o.d, o.data->>'time', o.data->>'timezone', o.status, o.data->>'project_ref', '/company/meetings?r=' || o.id,
         jsonb_build_object('recurring', coalesce(o.data->>'recurrence', 'none') <> 'none', 'meet_url', o.data->>'meet_url', 'duration', o.data->>'duration')
  from occ o where coalesce(o.status, '') <> 'Cancelled'
  union all
  select case x.section when 'company.milestones' then 'milestone' when 'company.tasks' then 'task' else
           case when coalesce(x.data->>'review_due', '') between f and t then 'review' else 'expiry' end end,
         x.id, x.title, left(case when x.section = 'company.documents' then case when coalesce(x.data->>'review_due', '') between f and t then x.data->>'review_due' else x.data->>'expiration_date' end else x.data->>'due' end, 10)::date,
         null, null, x.status, x.data->>'project_ref', case when x.section = 'company.documents' then '/documents?d=' || x.id else '/' || replace(x.section, '.', '/') || '?r=' || x.id end, '{}'::jsonb
  from other x where left(case when x.section = 'company.documents' then case when coalesce(x.data->>'review_due', '') between f and t then x.data->>'review_due' else x.data->>'expiration_date' end else x.data->>'due' end, 10) between f and t
  union all
  select 'approval', a.record_id, r.title, (a.expires_at at time zone 'utc')::date, null, null, a.status, r.data->>'project_ref', '/decide', jsonb_build_object('approval', a.id)
  from public.approvals a join public.records r on r.id = a.record_id
  where a.approver_id = me and a.status = 'pending' and (a.expires_at at time zone 'utc')::date between p_from and p_to and public.record_visible(r)
  order by 4, 5 nulls first;
end $$;
revoke execute on function public.calendar_items(date, date, text) from public, anon;
grant execute on function public.calendar_items(date, date, text) to authenticated;

-- the decision log with its links; titles of linked records only where the person may open them
create or replace function public.decision_log(p_q text default null, p_project uuid default null, p_status text default null, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); q text := lower(trim(coalesce(p_q, '')));
begin
  if me is null or not public.session_ok() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x->>'date' desc nulls last) from (
    select jsonb_build_object('id', d.id, 'number', d.data->>'doc_number', 'title', d.title, 'decision', d.data->>'decision', 'date', coalesce(d.data->>'date', to_char(d.created_at, 'YYYY-MM-DD')),
      'status', d.status, 'made_by', coalesce(d.data->>'made_by_id', d.created_by::text), 'responsible', d.data->>'responsible_id', 'due', d.data->>'due',
      'project', (select jsonb_build_object('id', p.id, 'title', p.title) from public.records p where p.id::text = d.data->>'project_ref' and public.record_visible(p)),
      'source', (select jsonb_build_object('id', s.id, 'title', s.title, 'section', s.section) from public.records s where s.id::text = d.data->>'source_ref' and public.record_visible(s)),
      'document', (select jsonb_build_object('id', s.id, 'title', s.title, 'number', s.data->>'doc_number') from public.records s where s.id::text = d.data->>'document_ref' and public.record_visible(s)),
      'task', (select jsonb_build_object('id', s.id, 'title', s.title, 'status', s.status) from public.records s where s.id::text = coalesce(d.data->>'task_ref', d.data->>'task_id') and public.record_visible(s)),
      'source_kind', coalesce(d.data->>'source_section', case when d.data->>'_idem' like 'approval:%' then 'approval' when d.data->>'_idem' like 'decision:comment:%' then 'discussion' end, 'management')) x
    from public.records d
    where d.section = 'company.decisions' and public.record_visible(d)
      and (p_project is null or d.data->>'project_ref' = p_project::text) and (p_status is null or d.status = p_status)
      and (q = '' or lower(d.title || ' ' || coalesce(d.data->>'decision', '') || ' ' || coalesce(d.data->>'doc_number', '')) like '%' || q || '%')
    order by d.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) s), '[]'::jsonb);
end $$;
revoke execute on function public.decision_log(text, uuid, text, integer) from public, anon;
grant execute on function public.decision_log(text, uuid, text, integer) to authenticated;

/* ---------------------------------------------------------------------------------------------
   10. Access rows for the knowledge base (internal roles read; everyone internal writes drafts)
   --------------------------------------------------------------------------------------------- */
insert into public.section_access(section, role, can_write, external)
select 'company.wiki', r, true, false from unnest(array['management', 'engineering', 'operations', 'finance', 'sales', 'marketing', 'hr', 'legal', 'security']) r
on conflict (section, role) do nothing;
/* ---------------------------------------------------------------------------------------------
   11. Backup and restore know the new tables (a restore drill brings back numbering, versions and the audit)
   --------------------------------------------------------------------------------------------- */
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

-- partners may read register entries explicitly shared with their company (never Confidential, Restricted or US-only:
-- those cannot carry a company)
insert into public.section_access(section, role, can_write, external) values ('company.documents', 'partner', false, true) on conflict (section, role) do nothing;

commit;
