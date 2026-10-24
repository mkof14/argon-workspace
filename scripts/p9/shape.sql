-- Production-shaped SYNTHETIC content for the migration rehearsal (scripts/p9/rehearse.sh). Invented values only.
-- Shape taken read-only from production (counts per section and status, data keys, controlled count) — no content.
set client_min_messages = warning;
begin;
-- three owners, as in production (synthetic addresses on the test domain)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', format('owner%s@agron-stack.test', i), '', now(), '{}', jsonb_build_object('full_name', 'Rehearsal Owner ' || i), now(), now()
from generate_series(1, 3) i;
update public.profiles set role = 'owner', us_person = true, title = 'Synthetic title', phone = '+1 555 0100' where email like 'owner%@agron-stack.test';

create temporary table shape(section text, status text, n int, controlled int, keys text[]) on commit drop;
insert into shape values
 ('legal.corporate','Active',2,0,'{entity,notes}'), ('legal.issues','Open',8,0,'{action,owner,priority,summary}'),
 ('legal.matrix','Active',403,0,'{jurisdiction,topic,requirement,notes}'), ('legal.obligations','Open',15,0,'{owner,due,notes}'),
 ('legal.programs','Active',9,0,'{owner,notes}'), ('legal.registers','Active',2,0,'{notes}'), ('legal.regulators','Active',32,0,'{country,url,notes}'),
 ('legal.requests','New',1,0,'{_tr,desk,due,jurisdiction,priority,request,requester}'), ('legal.trademarks','Filed',1,0,'{mark,office,notes}'),
 ('mail.outbox','Failed',8,0,'{cc,error,html,related,sender,template,to}'), ('marketing.brand','Active',7,0,'{notes}'),
 ('marketing.channels','Active',9,0,'{url,notes}'), ('marketing.events','Planned',5,0,'{date,venue,notes}'), ('marketing.media','Draft',2,0,'{notes}'),
 ('marketing.outlets','Active',15,0,'{url,notes}'), ('marketing.video','Draft',1,0,'{notes}'),
 ('operations.procurement','Draft',1,0,'{item,notes,vendor}'), ('operations.quality','Planned',1,0,'{check_type,findings,owner}'),
 ('technical.bom','Draft',1,0,'{config,item,notes}'), ('technical.docs','In review',7,1,'{config,doc_type,link,version}'),
 ('technical.equipment','Evaluating',7,5,'{category,config,manufacturer,model,notes,specs}'), ('technical.integration','Planned',1,1,'{device,icd,notes,protocol,sdk}'),
 ('technical.metrics','Draft',1,0,'{deploys,incidents,notes,period,tests_failed,tests_passed,uptime}'),
 ('technical.software','Backlog',1,1,'{component,notes,priority,release,repo_link,type}'),
 ('technical.systems','Unknown',8,0,'{console_url,environment,health_url,owner,provider,tier,type,url}');

insert into public.records(section, title, status, data, controlled, created_by)
select s.section, format('Rehearsal %s %s', s.section, i), s.status,
       (select jsonb_object_agg(k, format('synthetic %s %s', k, i)) from unnest(s.keys) k),
       i <= s.controlled, (select id from public.profiles order by created_at limit 1)
from shape s, generate_series(1, s.n) i;

insert into public.activity(record_id, section, actor, action, detail)
select r.id, r.section, r.created_by, 'created', jsonb_build_object('title', r.title) from public.records r order by r.id limit 87;
insert into storage.objects(bucket_id, name, metadata)
select 'files', format('%s/%s/1700000000000_rehearsal-%s.pdf', r.section, r.id, i), jsonb_build_object('size', 1000 + i, 'mimetype', 'application/pdf')
from (select id, section, row_number() over (order by id) i from public.records order by id limit 19) r;
insert into public.ai_usage(user_id, model, input_tokens, output_tokens)
select (select id from public.profiles order by created_at limit 1), 'synthetic', 100, 50 from generate_series(1, 25);
commit;
