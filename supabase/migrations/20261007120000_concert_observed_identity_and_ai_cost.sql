-- Observations from printed annex columns are distinct from reviewed identities.
alter table public.record_units
 add column if not exists observed_provider_name text,
 add column if not exists observed_service_name text;

-- Only settled provider charges with a valid per-job item key are attributed.
-- A reservation is not an incurred cost; a run can contain many records.
create or replace view public.ai_cost_per_record as
select j.source_record_id,r.financing_type,sum(b.actual_usd)::numeric as cost_usd
from public.cloud_budget_reservations b
join public.worker_tasks t on t.id=b.task_id
join public.pipeline_jobs j on j.id=case
 when split_part(b.item_key,':',2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then split_part(b.item_key,':',2)::uuid else t.pipeline_job_id end
join public.source_records r on r.id=j.source_record_id
where b.actual_usd is not null and b.item_key like 'ai:%'
group by j.source_record_id,r.financing_type;

create or replace view public.ai_cost_summary as
select case when financing_type='concert' then 'concert' else 'altres' end as scope,
 count(*)::integer as measured_records,
 sum(cost_usd)::numeric as total_usd,
 avg(cost_usd)::numeric as average_usd
from public.ai_cost_per_record
group by 1;

revoke all on public.ai_cost_per_record,public.ai_cost_summary from anon,authenticated;
grant select on public.ai_cost_per_record,public.ai_cost_summary to service_role;
