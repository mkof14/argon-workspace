-- AGRON Workspace v0.7: board & governance sections, tasks, smart search, name clean-up
-- 1. Access for the new sections
insert into public.section_access(section, role, can_write, external) values
('legal.board','management',true,false),
('legal.board','legal',true,false),
('legal.board','finance',false,false),
('legal.registers','management',true,false),
('legal.registers','legal',true,false),
('legal.registers','finance',false,false),
('legal.authority','management',true,false),
('legal.authority','legal',true,false),
('legal.authority','finance',false,false),
('company.tasks','management',true,false),
('company.tasks','engineering',true,false),
('company.tasks','operations',true,false),
('company.tasks','finance',true,false),
('company.tasks','sales',true,false),
('company.tasks','marketing',true,false),
('company.tasks','hr',true,false),
('company.tasks','legal',true,false),
('company.tasks','security',true,false)
on conflict (section, role) do nothing;

-- 2. Smart search across every record the user may see (row-level security applies)
create or replace function public.search_records(q text, n int default 25)
returns setof public.records language sql stable security invoker set search_path = public as $$
  select r.* from public.records r
  where not exists (
    select 1 from unnest(string_to_array(lower(trim(q)), ' ')) w
    where w <> '' and position(w in lower(r.title || ' ' || coalesce(r.data::text, ''))) = 0)
  order by (lower(r.title) like '%' || lower(trim(q)) || '%') desc, r.updated_at desc
  limit least(greatest(coalesce(n, 25), 1), 50);
$$;
revoke all on function public.search_records(text, int) from public, anon;
grant execute on function public.search_records(text, int) to authenticated;

-- 3. Only StarDome as the product name; only AGRON as the trademark
delete from public.records where section = 'legal.trademarks' and title in ('StarDome', 'StarWall', 'AGRON 1');
update public.records set title = 'Trademark: AGRON' where section = 'legal.issues' and title ilike 'Trademarks:%';
update public.records set title = replace(title, 'StarWall', 'StarDome'), data = replace(replace(data::text, 'StarWall adapters', 'Device adapters'), 'StarWall', 'StarDome')::jsonb
  where title ilike '%starwall%' or data::text ilike '%starwall%';
update public.records set data = replace(replace(data::text, 'Invention disclosure', 'Copyright'), 'Patent application', 'Code ownership')::jsonb
  where section = 'legal.ip' and data::text ~* 'patent|invention';
update public.records set data = jsonb_set(data, '{role}', '"Trademarks"') where section = 'legal.regulators' and title = 'USPTO';
delete from public.ai_cache where answer ilike '%starwall%' or question ilike '%starwall%';

-- 4. Starting rows for the register
insert into public.records(section, title, status, data)
select 'legal.registers', 'Michael Kofman', 'Active', '{"role":"Director","entity":"AGRON Inc. (Delaware)","us_person":true}'::jsonb
where not exists (select 1 from public.records where section = 'legal.registers');
insert into public.records(section, title, status, data)
select 'legal.registers', 'Michael Kofman — CEO', 'Active', '{"role":"Officer","entity":"AGRON Inc. (Delaware)","position":"Chief Executive Officer","us_person":true}'::jsonb
where (select count(*) from public.records where section = 'legal.registers') = 1;
