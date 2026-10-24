-- Phase 9 (B49) data-quality checks: exact counts only, read-only, no repair. Run on a v26 database (staging, the
-- stack, a restore). Every line is a count of rows that need a person's decision; 0 = clean.
select json_build_object(
 'records_with_unknown_creator', (select count(*) from records r where r.created_by is not null and not exists (select 1 from profiles p where p.id = r.created_by)),
 'profiles_without_sign_in_account', (select count(*) from profiles p where not exists (select 1 from auth.users u where u.id = p.id)),
 'profiles_pending_role', (select count(*) from profiles where role = 'pending'),
 'profiles_unknown_role', (select count(*) from profiles where role not in (select distinct role from section_access) and role not in ('owner','admin','pending')),
 'disabled_profiles', (select count(*) from profiles where disabled),
 'duplicate_organizations', (select coalesce(sum(n - 1), 0) from (select count(*) n from records where section = 'company.parties' group by lower(btrim(title)) having count(*) > 1) d),
 'document_versions_without_entry', (select count(*) from document_versions v where not exists (select 1 from records r where r.id = v.record_id) and not exists (select 1 from records_trash t where t.id = v.record_id)),
 'document_versions_without_file', (select count(*) from document_versions v where not exists (select 1 from storage.objects o where o.bucket_id = 'files' and o.name = v.path)),
 'open_tasks_without_owner', (select count(*) from records where section = 'company.tasks' and coalesce(status, '') not in ('Done', 'Cancelled') and coalesce(data->>'owner_id', '') = ''),
 'workflow_runs_on_missing_definition', (select count(*) from wf_instances i where not exists (select 1 from wf_definitions d where d.id = i.definition_id)),
 'open_opportunities_without_owner', (select count(*) from records where section = 'sales.pipeline' and coalesce(status, '') not in ('Won', 'Lost', 'Closed Won', 'Closed Lost') and coalesce(data->>'owner_id', data->>'owner', '') = ''),
 'bom_lines_without_revision', (select count(*) from mfg_bom_lines l where not exists (select 1 from records r where r.id = l.bom_id) and not exists (select 1 from records_trash t where t.id = l.bom_id)),
 'bom_lines_with_unknown_item', (select count(*) from mfg_bom_lines l where not exists (select 1 from records r where r.id = l.item_id and r.section = 'technical.items')),
 'negative_stock_rows', (select count(*) from mfg_stock where qty < 0),
 'duplicate_serials_per_item', (select coalesce(sum(n - 1), 0) from (select count(*) n from mfg_serials group by item_id, lower(serial) having count(*) > 1) d),
 'serials_installed_twice', (select coalesce(sum(n - 1), 0) from (select count(*) n from mfg_installs where removed_at is null and serial_id is not null group by serial_id having count(*) > 1) d),
 'installs_on_missing_unit', (select count(*) from mfg_installs i where not exists (select 1 from records r where r.id = i.unit_id)),
 'build_units_with_unknown_product', (select count(*) from records b where b.section = 'operations.builds' and coalesce(b.data->>'product_ref', '') <> '' and not exists (select 1 from records p where p.id::text = b.data->>'product_ref')),
 'build_units_with_unknown_configuration', (select count(*) from records b where b.section = 'operations.builds' and coalesce(b.data->>'config_ref', '') <> '' and not exists (select 1 from records c where c.id::text = b.data->>'config_ref')),
 'comments_on_missing_record', (select count(*) from comments c where not exists (select 1 from records r where r.id = c.record_id)),
 'files_outside_any_record', (select count(*) from storage.objects o where o.bucket_id = 'files' and split_part(o.name, '/', 2) ~ '^[0-9a-f-]{36}$'
     and not exists (select 1 from records r where r.id::text = split_part(o.name, '/', 2)) and not exists (select 1 from records_trash t where t.id::text = split_part(o.name, '/', 2)))
) dq;
