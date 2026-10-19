-- After Supabase Auth has created its schema: the helpers Supabase adds on top, and API grants.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
grant all on all tables in schema auth to postgres;
