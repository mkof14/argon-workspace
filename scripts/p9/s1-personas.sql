-- P9-S1 — the 13 SYNTHETIC staging personas, created inside the staging database (never production).
-- Addresses @agron-stack.test (no mailbox exists, nothing is sent); passwords are random and never known: a hosted
-- sign-in test first sets a password with the service key (owner-provided), the database tests use JWT claims.
do $$
declare p jsonb; uid uuid; c text;
begin
  if exists (select 1 from public.profiles where full_name like 'P9 Synthetic %') then raise notice 'personas exist'; return; end if;
  for p in select * from jsonb_array_elements('[
  {"key":"owner-us","role":"owner","us":true},
  {"key":"mgmt-us","role":"management","us":true},
  {"key":"mgmt-nonus","role":"management","us":false},
  {"key":"eng-us","role":"engineering","us":true,"caps":["bom_editor"]},
  {"key":"eng-nonus","role":"engineering","us":false},
  {"key":"sales","role":"sales","us":true},
  {"key":"operations","role":"operations","us":true},
  {"key":"manufacturing","role":"operations","us":true,"caps":["build_manager","work_order_manager","inventory_manager","quality_inspector"]},
  {"key":"technician","role":"operations","us":true,"caps":["test_operator"]},
  {"key":"sysadmin","role":"admin","us":true},
  {"key":"partner","role":"partner","us":false,"company":"P9 Synthetic Partner Co"},
  {"key":"vendor","role":"vendor","us":false,"company":"P9 Synthetic Vendor Co"},
  {"key":"disabled","role":"sales","us":true,"disabled":true}]'::jsonb)
  loop
    uid := gen_random_uuid();
    insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', 'p9s1-' || (p->>'key') || '@agron-stack.test',
              extensions.crypt(encode(extensions.gen_random_bytes(24), 'base64'), extensions.gen_salt('bf')), now(),
              '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', 'P9 Synthetic ' || (p->>'key')), now(), now(), '', '', '', '');
    insert into auth.identities(id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', 'p9s1-' || (p->>'key') || '@agron-stack.test', 'email_verified', true), 'email', null, now(), now());
    update public.profiles set role = p->>'role', us_person = coalesce((p->>'us')::boolean, false), company = p->>'company', full_name = 'P9 Synthetic ' || (p->>'key'), disabled = coalesce((p->>'disabled')::boolean, false) where id = uid;
    for c in select jsonb_array_elements_text(coalesce(p->'caps', '[]')) loop insert into public.crm_caps(user_id, cap, granted_by) values (uid, c, uid); end loop;
  end loop;
end $$;
