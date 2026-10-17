-- v14: automatic translations are stored inside each record (data._tr).
-- Writing them must not look like a user edit: no activity entry and the record keeps its "updated" time.
create or replace function public.log_record_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity(record_id, section, actor, action, detail) values (new.id, new.section, auth.uid(), 'created', jsonb_build_object('title', new.title, 'status', new.status));
  elsif tg_op = 'UPDATE' then
    -- Only the translations changed: keep the time and the log as they are
    if new.title is not distinct from old.title and new.status is not distinct from old.status
       and new.company is not distinct from old.company and new.controlled is not distinct from old.controlled
       and (new.data - '_tr') is not distinct from (old.data - '_tr') then
      new.updated_at := old.updated_at;
      return new;
    end if;
    new.updated_at := now();
    insert into public.activity(record_id, section, actor, action, detail) values (new.id, new.section, auth.uid(),
      case when new.status is distinct from old.status then 'status' else 'updated' end,
      jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status));
  elsif tg_op = 'DELETE' then
    insert into public.activity(record_id, section, actor, action, detail) values (old.id, old.section, auth.uid(), 'deleted', jsonb_build_object('title', old.title));
    return old;
  end if;
  return new;
end $$;
revoke execute on function public.log_record_change() from authenticated, anon, public;
