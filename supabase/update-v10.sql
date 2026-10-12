-- AGRON Workspace v1.3 — Ask your documents
-- Page-level text of attached files, searchable with full-text search. Visible exactly like the record it belongs to.
begin;

create table if not exists public.doc_pages (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.records(id) on delete cascade,
  path text not null,
  file_name text not null,
  page int not null,
  content text not null,
  tsv tsvector generated always as (to_tsvector('simple', coalesce(file_name, '') || ' ' || content)) stored,
  created_at timestamptz not null default now(),
  unique (path, page)
);
create index if not exists doc_pages_tsv_idx on public.doc_pages using gin (tsv);
create index if not exists doc_pages_record_idx on public.doc_pages (record_id);
alter table public.doc_pages enable row level security;
drop policy if exists p_doc_pages_read on public.doc_pages;
create policy p_doc_pages_read on public.doc_pages for select to authenticated
  using (exists (select 1 from public.records r where r.id = doc_pages.record_id and public.record_visible(r.*)));
-- No insert/update/delete policies: only the server (service role) writes the index.

-- Search as the caller (row-level security applies). q is a to_tsquery expression built by the server.
create or replace function public.doc_search(q text, n int default 12)
returns table (record_id uuid, path text, file_name text, page int, content text, rank real, section text, title text)
language sql stable security invoker set search_path = public as $$
  select d.record_id, d.path, d.file_name, d.page, d.content, ts_rank(d.tsv, to_tsquery('simple', q)) as rank, r.section, r.title
  from public.doc_pages d join public.records r on r.id = d.record_id
  where d.tsv @@ to_tsquery('simple', q)
  order by rank desc
  limit least(greatest(n, 1), 30)
$$;
revoke execute on function public.doc_search(text, int) from public, anon;
grant execute on function public.doc_search(text, int) to authenticated;

-- Attached files the caller can see that are not indexed yet (PDF, Word, Excel, PowerPoint, text).
create or replace function public.docs_pending(n int default 50)
returns table (path text, record_id uuid)
language sql stable security definer set search_path = public, storage as $$
  select o.name, split_part(o.name, '/', 2)::uuid
  from storage.objects o
  where o.bucket_id = 'files'
    and o.name not like '\_intake/%'
    and o.name ~* '\.(pdf|docx|xlsx|pptx|txt|md|csv)$'
    and split_part(o.name, '/', 2) ~ '^[0-9a-f-]{36}$'
    and not exists (select 1 from public.doc_pages d where d.path = o.name)
    and public.file_visible(o.name)
  order by o.created_at
  limit least(greatest(n, 1), 200)
$$;
revoke execute on function public.docs_pending(int) from public, anon;
grant execute on function public.docs_pending(int) to authenticated;

-- How much is indexed for the caller
create or replace function public.docs_stats()
returns table (files bigint, pages bigint)
language sql stable security invoker set search_path = public as $$
  select count(distinct path), count(*) from public.doc_pages
$$;
revoke execute on function public.docs_stats() from public, anon;
grant execute on function public.docs_stats() to authenticated;

commit;
