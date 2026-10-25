-- P9-S1 — synthetic hidden fixtures for the hosted security run (staging only). Every title carries "P9SYN SECRET"
-- (US-persons-only) or "P9SYN RESTRICTED" so any appearance in a read model is detected. Settings: p9s1.run, p9s1.part = pre | hidden.
-- Each fixture names the personas that must NOT see it (hidden_from) and a positive control that MUST (visible_to).
do $$
declare
  run text := current_setting('p9s1.run');
  pid record; e_non uuid; m_non uuid; e_us uuid; m_us uuid; sales uuid; own uuid; vis uuid; t1 uuid; t2 uuid; pr uuid; o1 uuid; o2 uuid; mt uuid; d1 uuid; c1 uuid;
  nonus text[] := array['eng-nonus', 'mgmt-nonus', 'partner', 'vendor'];
begin
  select id into e_non from public.profiles where full_name = 'P9 Synthetic eng-nonus';
  select id into m_non from public.profiles where full_name = 'P9 Synthetic mgmt-nonus';
  select id into e_us from public.profiles where full_name = 'P9 Synthetic eng-us';
  select id into m_us from public.profiles where full_name = 'P9 Synthetic mgmt-us';
  select id into sales from public.profiles where full_name = 'P9 Synthetic sales';
  select id into own from public.profiles where full_name = 'P9 Synthetic owner-us';
  if current_setting('p9s1.part') = 'pre' then
    -- part 1 (before the reference snapshot): a visible task of the non-US engineer, and a RESTRICTED (not US-only)
    -- deal that only the named salesperson — and management, by the existing rule — may open
    insert into public.records(section, title, status, data, created_by) values ('company.tasks', 'P9SYN visible task ' || run, 'In Progress', jsonb_build_object('assignee_id', e_non, 'due', current_date::text), own) returning id into vis;
    insert into public.records(section, title, status, data, created_by) values ('sales.pipeline', 'P9SYN RESTRICTED deal ' || run, 'Qualified', jsonb_build_object('owner_id', sales, 'restricted', true, 'access_ids', jsonb_build_array(sales), 'value', 750000, 'currency', 'USD'), sales) returning id into o2;
    insert into p9s1.fixtures(run, key, id, section, hidden_from, visible_to) values
      (run, 'restricted_deal', o2, 'sales.pipeline', array['eng-us', 'eng-nonus', 'operations', 'technician', 'manufacturing', 'partner', 'vendor'], array['sales', 'owner-us']);
    return;
  end if;
  -- part 2 (between the reference and the final snapshot): only US-persons-only records — nothing the non-US personas
  -- may see is added, so their read models must stay identical
  select id into vis from public.records where title = 'P9SYN visible task ' || run;
  -- US-persons-only (controlled) records that name the non-US people directly
  insert into public.records(section, title, status, data, controlled, created_by) values ('company.tasks', 'P9SYN SECRET overdue task ' || run, 'In Progress', jsonb_build_object('assignee_id', e_non, 'due', (current_date - 3)::text, 'priority', 'High'), true, own) returning id into t1;
  insert into public.records(section, title, status, data, controlled, created_by) values ('company.tasks', 'P9SYN SECRET dependent ' || run, 'To Do', jsonb_build_object('assignee_id', e_us, 'blocked_by', vis, 'due', (current_date + 1)::text), true, own) returning id into t2;
  insert into public.records(section, title, status, data, controlled, created_by) values ('company.projects', 'P9SYN SECRET program ' || run, 'Active', jsonb_build_object('owner_id', m_non), true, own) returning id into pr;
  insert into public.records(section, title, status, data, controlled, created_by) values ('sales.pipeline', 'P9SYN SECRET opportunity ' || run, 'Negotiation', jsonb_build_object('owner_id', m_non, 'value', 9000000, 'currency', 'USD', 'next_action', 'call', 'next_action_due', (current_date - 2)::text), true, own) returning id into o1;
  insert into public.records(section, title, status, data, controlled, created_by) values ('company.meetings', 'P9SYN SECRET briefing ' || run, 'Planned', jsonb_build_object('date', current_date::text, 'time', '23:30', 'timezone', 'UTC', 'organizer_id', m_us, 'participants_ids', jsonb_build_array(e_non, m_non, e_us)), true, own) returning id into mt;
  insert into public.records(section, title, status, data, controlled, created_by) values ('company.documents', 'P9SYN SECRET controlled document ' || run, 'Draft', jsonb_build_object('project_ref', pr), true, own) returning id into d1;
  -- a promise the non-US engineer once wrote on what is now US-persons-only
  insert into public.comments(record_id, author, body) values (t1, e_non, 'P9SYN SECRET I will send the report tomorrow') returning id into c1;
  -- a file of the controlled document (storage metadata only; the object body is not needed for access tests)
  insert into storage.objects(bucket_id, name, owner, metadata) values ('files', 'company.documents/' || d1 || '/p9syn-secret.pdf', own, '{"mimetype":"application/pdf","size":1}');
  insert into p9s1.fixtures(run, key, id, section, hidden_from, visible_to) values
    (run, 'controlled_task', t1, 'company.tasks', nonus, array['eng-us', 'mgmt-us', 'owner-us']),
    (run, 'controlled_dependent', t2, 'company.tasks', nonus, array['eng-us']),
    (run, 'controlled_project', pr, 'company.projects', nonus, array['mgmt-us', 'owner-us']),
    (run, 'controlled_opportunity', o1, 'sales.pipeline', nonus, array['owner-us', 'mgmt-us']),
    (run, 'controlled_meeting', mt, 'company.meetings', nonus, array['mgmt-us', 'eng-us']),
    (run, 'controlled_document', d1, 'company.documents', nonus, array['owner-us']);
end $$;
