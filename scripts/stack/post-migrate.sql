-- As in the production project: records and comments are published for realtime (subscribers still pass RLS)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'records') then alter publication supabase_realtime add table public.records; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'comments') then alter publication supabase_realtime add table public.comments; end if;
end $$;
-- A storage bucket for attachments exists in every Workspace project
insert into storage.buckets(id, name, public, file_size_limit) values ('files', 'files', false, 52428800) on conflict do nothing;
