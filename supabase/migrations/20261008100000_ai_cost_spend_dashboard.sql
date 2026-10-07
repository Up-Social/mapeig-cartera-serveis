-- An AI item key identifies one provider request. Reanalysis may copy its
-- reservation to a new worker task; those copies are not additional charges.
create view public.ai_cost_per_call as
select distinct on (b.item_key)
 b.item_key,
 j.source_record_id,
 j.run_id,
 b.reserved_usd,
 b.actual_usd
from public.cloud_budget_reservations b
join public.worker_tasks t on t.id=b.task_id
join public.pipeline_jobs j on j.id=case
 when split_part(b.item_key,':',2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then split_part(b.item_key,':',2)::uuid else t.pipeline_job_id end
where b.item_key like 'ai:%'
order by b.item_key,(b.actual_usd is not null) desc,b.actual_usd desc,t.created_at,b.task_id;

create or replace view public.ai_cost_per_record as
select c.source_record_id,r.financing_type,sum(c.actual_usd)::numeric as cost_usd
from public.ai_cost_per_call c
join public.source_records r on r.id=c.source_record_id
where c.actual_usd is not null
group by c.source_record_id,r.financing_type;

create or replace view public.ai_cost_summary as
with reviewed as (
 select distinct source_record_id from public.review_decisions
), classified as (
 select c.*,case when r.financing_type='concert' then 'concert' else 'altres' end as scope,
  (reviewed.source_record_id is not null) as is_reviewed
 from public.ai_cost_per_call c
 join public.source_records r on r.id=c.source_record_id
 left join reviewed on reviewed.source_record_id=c.source_record_id
)
select scope,
 count(distinct source_record_id) filter(where actual_usd is not null)::integer as measured_records,
 coalesce(sum(actual_usd),0)::numeric as total_usd,
 (sum(actual_usd)/nullif(count(distinct source_record_id) filter(where actual_usd is not null),0))::numeric as average_usd,
 count(*) filter(where actual_usd is not null)::integer as measured_calls,
 count(distinct run_id) filter(where actual_usd is not null)::integer as runs_with_cost,
 count(distinct source_record_id) filter(where actual_usd is not null and is_reviewed)::integer as reviewed_records,
 count(*) filter(where actual_usd is null)::integer as unsettled_calls,
 coalesce(sum(reserved_usd) filter(where actual_usd is null),0)::numeric as pending_reserved_usd
from classified
group by scope;

revoke all on public.ai_cost_per_call,public.ai_cost_per_record,public.ai_cost_summary from anon,authenticated;
grant select on public.ai_cost_per_call,public.ai_cost_per_record,public.ai_cost_summary to service_role;
