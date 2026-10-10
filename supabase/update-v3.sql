-- AGRON Workspace v0.3: FAQ knowledge base and AI answer cache
create extension if not exists pg_trgm with schema extensions;
create table if not exists public.faq (
  id uuid primary key default gen_random_uuid(),
  question text not null, answer text not null,
  lang text not null default 'en', section text,
  verified boolean not null default false, hits integer not null default 0,
  source text not null default 'manual',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists faq_question_trgm on public.faq using gin (question extensions.gin_trgm_ops);
alter table public.faq enable row level security;
-- Owner, admin, management and legal curate the FAQ (mark answers verified)
create or replace function public.can_curate() returns boolean
language sql stable security definer set search_path = public as $f$
  select coalesce((select role in ('owner','admin','management','legal') from public.profiles where id = auth.uid()), false)
$f$;
drop policy if exists p_faq_read on public.faq;
create policy p_faq_read on public.faq for select using (auth.uid() is not null and (not public.is_external() or verified));
drop policy if exists p_faq_insert on public.faq;
create policy p_faq_insert on public.faq for insert with check (not public.is_external() and (not verified or public.can_curate()));
drop policy if exists p_faq_update on public.faq;
create policy p_faq_update on public.faq for update using (public.can_curate() or created_by = auth.uid()) with check (public.can_curate() or (created_by = auth.uid() and not verified));
drop policy if exists p_faq_delete on public.faq;
create policy p_faq_delete on public.faq for delete using (public.can_curate() or created_by = auth.uid());
-- Similar-question search (trigram)
create or replace function public.faq_search(q text, lng text default null, n int default 5)
returns table(id uuid, question text, answer text, lang text, section text, verified boolean, hits int, sim real)
language sql stable security invoker set search_path = public, extensions as $f$
  select f.id, f.question, f.answer, f.lang, f.section, f.verified, f.hits,
         greatest(similarity(lower(f.question), lower(q)), word_similarity(lower(q), lower(f.question)))::real as sim
  from public.faq f
  where (lng is null or f.lang = lng)
    and greatest(similarity(lower(f.question), lower(q)), word_similarity(lower(q), lower(f.question))) > 0.25
  order by sim desc, f.verified desc, f.hits desc
  limit n
$f$;
create or replace function public.faq_hit(fid uuid) returns void
language sql security definer set search_path = public as $f$ update public.faq set hits = hits + 1 where id = fid $f$;
revoke execute on function public.faq_hit(uuid), public.can_curate() from public, anon;
grant execute on function public.faq_hit(uuid), public.can_curate(), public.faq_search(text, text, int) to authenticated;
-- Server-side AI answer cache (service key only; no policies on purpose)
create table if not exists public.ai_cache (
  key text primary key, question text, answer text, section text, lang text, tier text,
  hits integer not null default 0, created_at timestamptz not null default now(), last_hit timestamptz
);
alter table public.ai_cache enable row level security;

-- The workspace also loads this starter FAQ automatically the first time an owner opens FAQ & Learning Center.
-- Starter FAQ (verified)
insert into public.faq (question, answer, lang, section, verified, source)
select * from (values
($q$How do I sign in?$q$,$q$Enter your work email on the sign-in page and click the link that arrives. No password is needed. If nothing arrives in a minute, check Spam.$q$,$q$en$q$,null,true,$q$seed$q$),
($q$Как войти в кабинет?$q$,$q$Введите рабочий email на странице входа и нажмите ссылку из письма. Пароль не нужен. Если письма нет через минуту — проверьте «Спам».$q$,$q$ru$q$,null,true,$q$seed$q$),
($q$Why don't I see some departments?$q$,$q$Your role decides which sections you see. Ask the owner or an administrator to change your role or access in Users & roles.$q$,$q$en$q$,null,true,$q$seed$q$),
($q$Почему я не вижу некоторые отделы?$q$,$q$Набор разделов зависит от роли. Попросите владельца или администратора изменить роль или доступ в «Пользователи и роли».$q$,$q$ru$q$,null,true,$q$seed$q$),
($q$Why can't I mark a deal as Won?$q$,$q$Sanctions and end-user screening must be Cleared first. Set the screening field to Cleared after the check in Security → Restricted-party screening.$q$,$q$en$q$,$q$sales.pipeline$q$,true,$q$seed$q$),
($q$Почему сделка не переходит в Won?$q$,$q$Сначала санкционная проверка и проверка конечного пользователя должны быть Cleared. Отметьте результат после проверки в «Безопасность» → «Санкционные проверки».$q$,$q$ru$q$,$q$sales.pipeline$q$,true,$q$seed$q$),
($q$Why can't a container move to Shipping?$q$,$q$The export and end-user check must be Cleared before shipping. Update the Export check field once Legal confirms.$q$,$q$en$q$,$q$operations.builds$q$,true,$q$seed$q$),
($q$Почему контейнер не переходит в Shipping?$q$,$q$До отгрузки экспортная проверка и проверка конечного пользователя должны быть Cleared. Обновите поле после подтверждения юристов.$q$,$q$ru$q$,$q$operations.builds$q$,true,$q$seed$q$),
($q$What does Controlled mean?$q$,$q$The record contains technical data under US export control. Only users marked US person can see it; the database enforces this.$q$,$q$en$q$,null,true,$q$seed$q$),
($q$Что значит «Контролируемые»?$q$,$q$В записи технические данные под экспортным контролем США. Видят только пользователи с отметкой US person; это защищено на уровне базы данных.$q$,$q$ru$q$,null,true,$q$seed$q$),
($q$How do I send a presentation to a client?$q$,$q$Open Marketing → Media library, open the item and click Email. Or in any email click “Add files from Media library”. Links stay valid for 7 days.$q$,$q$en$q$,$q$marketing.media$q$,true,$q$seed$q$),
($q$Как отправить клиенту презентацию?$q$,$q$Откройте «Маркетинг» → «Медиатека», откройте материал и нажмите «Письмо». Или в любом письме — «Добавить файлы из Медиатеки». Ссылки действуют 7 дней.$q$,$q$ru$q$,$q$marketing.media$q$,true,$q$seed$q$),
($q$How do I invite a partner or vendor?$q$,$q$Administration → Users & roles → Invite: enter the email, role Partner or Vendor, and their company name. They will see only records shared with that company.$q$,$q$en$q$,null,true,$q$seed$q$),
($q$Как пригласить партнёра или поставщика?$q$,$q$«Администрирование» → «Пользователи и роли» → «Пригласить»: email, роль «Партнёр» или «Поставщик» и название компании. Они увидят только записи, открытые этой компании.$q$,$q$ru$q$,null,true,$q$seed$q$),
($q$How do I share a record with a partner?$q$,$q$In the record set External visibility to the partner's company name, or * for all partners, vendors and investors.$q$,$q$en$q$,null,true,$q$seed$q$),
($q$Как открыть запись партнёру?$q$,$q$В записи укажите в поле «Видимость для внешних» название компании партнёра или * — для всех партнёров, поставщиков и инвесторов.$q$,$q$ru$q$,null,true,$q$seed$q$),
($q$Does the AI give legal advice?$q$,$q$No. Legal, export and tax answers are preliminary and marked so. Final decisions are made by counsel.$q$,$q$en$q$,null,true,$q$seed$q$),
($q$Даёт ли ИИ юридические консультации?$q$,$q$Нет. Юридические, экспортные и налоговые ответы предварительные и так помечены. Окончательное решение принимает юрист.$q$,$q$ru$q$,null,true,$q$seed$q$),
($q$How is AI cost controlled?$q$,$q$One company API key, a monthly limit per user, Quick mode by default, cached instructions, and reuse of saved answers: repeated questions are answered from the FAQ for free.$q$,$q$en$q$,null,true,$q$seed$q$),
($q$Как контролируются расходы на ИИ?$q$,$q$Один ключ API компании, месячный лимит на пользователя, режим «Быстро» по умолчанию, кэширование инструкций и повторное использование ответов: повторные вопросы отвечаются из FAQ бесплатно.$q$,$q$ru$q$,null,true,$q$seed$q$),
($q$Where are files stored and how big can they be?$q$,$q$In the company's private Supabase storage, up to 50 MB per file. Access follows the record: if you can't see the record, you can't open its files.$q$,$q$en$q$,null,true,$q$seed$q$),
($q$Где хранятся файлы и какого размера?$q$,$q$В закрытом хранилище Supabase компании, до 50 МБ на файл. Доступ как у записи: не видите запись — не откроете и файлы.$q$,$q$ru$q$,null,true,$q$seed$q$),
($q$Can I store ITAR technical data here?$q$,$q$No. This workspace runs on commercial cloud. ITAR data needs a separate compliant environment agreed with export counsel.$q$,$q$en$q$,null,true,$q$seed$q$),
($q$Можно ли хранить здесь ITAR-данные?$q$,$q$Нет. Кабинет работает в коммерческом облаке. Для ITAR нужна отдельная среда, согласованная с экспортным юристом.$q$,$q$ru$q$,null,true,$q$seed$q$)
) v(question, answer, lang, section, verified, source)
where not exists (select 1 from public.faq where source = 'seed');
select count(*) as faq_rows from public.faq;
