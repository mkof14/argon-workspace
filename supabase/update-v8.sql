-- AGRON Workspace v1.0: indexes for foreign keys (audit)
create index if not exists ai_usage_user_id_idx on public.ai_usage(user_id);
create index if not exists comments_author_idx on public.comments(author);
create index if not exists comments_record_id_idx on public.comments(record_id);
create index if not exists faq_created_by_idx on public.faq(created_by);
create index if not exists records_created_by_idx on public.records(created_by);
create index if not exists records_section_updated_idx on public.records(section, updated_at desc);
