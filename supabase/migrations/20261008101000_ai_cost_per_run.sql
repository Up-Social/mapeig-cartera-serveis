-- One row per execution avoids pagination truncating detailed batch costs.
create view public.ai_cost_per_run as
select run_id,
 coalesce(sum(actual_usd),0)::numeric as total_usd,
 count(*) filter(where actual_usd is not null)::integer as measured_calls,
 coalesce(sum(reserved_usd) filter(where actual_usd is null),0)::numeric as pending_reserved_usd,
 count(*) filter(where actual_usd is null)::integer as unsettled_calls
from public.ai_cost_per_call
group by run_id;

revoke all on public.ai_cost_per_run from anon,authenticated;
grant select on public.ai_cost_per_run to service_role;
