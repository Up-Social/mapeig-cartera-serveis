-- Fence sandbox reservation by the task lease in the same transaction. Lock
-- order matches cloud_claim and cloud_resource: setting -> task -> resource.
create function public.cloud_acquire_sandbox(p_task uuid,p_owner uuid,p_generation bigint) returns boolean
language plpgsql security invoker set search_path=public as $$
declare acquired boolean;
begin
 perform public.assert_processing_enabled();
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 -- now() is fixed at transaction start; a lock wait can cross the real deadline.
 if not exists(select 1 from public.worker_tasks where id=p_task and lease_owner=p_owner
  and lease_generation=p_generation and execution_state='running' and lease_until>clock_timestamp())
 then raise exception 'CLOUD_LEASE_LOST';end if;
 acquired:=public.cloud_resource('sandbox',p_owner);
 -- A concurrent owner can hold the resource row while the task lease expires.
 -- Raising here rolls back any reservation acquired in this transaction.
 if not exists(select 1 from public.worker_tasks where id=p_task and lease_owner=p_owner
  and lease_generation=p_generation and execution_state='running' and lease_until>clock_timestamp())
 then raise exception 'CLOUD_LEASE_LOST';end if;
 if acquired then
  -- Ensure the validated owner has sufficient lease time for VM creation.
  update public.worker_tasks set lease_until=clock_timestamp()+interval '4 minutes',last_progress_at=clock_timestamp() where id=p_task;
  update public.cloud_resources set lease_until=clock_timestamp()+interval '12 minutes' where name='sandbox' and owner=p_owner;
 end if;
 return acquired;
end $$;
revoke all on function public.cloud_acquire_sandbox(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.cloud_acquire_sandbox(uuid,uuid,bigint) to service_role;
