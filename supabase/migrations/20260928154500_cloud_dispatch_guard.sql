create or replace function public.guard_blocked_cloud_dispatch() returns trigger
language plpgsql security invoker set search_path=public as $$
declare blocked text;
begin
 if new.executor<>'vercel_workflow' then return new;end if;
 select blocked_kind into blocked from cloud_resources where name='sandbox';
 if blocked is not null then raise exception 'CLOUD_RESOURCE_BLOCKED:%',blocked using errcode='55000';end if;
 return new;
end $$;

drop trigger if exists guard_blocked_cloud_dispatch on public.worker_tasks;
create trigger guard_blocked_cloud_dispatch before insert on public.worker_tasks
for each row execute function public.guard_blocked_cloud_dispatch();

revoke all on function public.guard_blocked_cloud_dispatch() from public,anon,authenticated;
