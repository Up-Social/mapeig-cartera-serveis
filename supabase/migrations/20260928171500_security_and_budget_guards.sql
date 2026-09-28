create table public.access_login_limits (
  attempt_key text primary key,
  attempts integer not null default 0 check (attempts >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.access_login_limits enable row level security;
revoke all on public.access_login_limits from public, anon, authenticated;
grant select, insert, update, delete on public.access_login_limits to service_role;

create or replace function public.access_login_attempt(p_key text, p_success boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_limit access_login_limits;
  next_attempts integer;
begin
  if p_key is null or length(p_key) < 20 then return false; end if;
  delete from access_login_limits where updated_at < now() - interval '2 days';
  select * into current_limit from access_login_limits where attempt_key = p_key for update;
  if current_limit.blocked_until > now() then return false; end if;
  if p_success then
    delete from access_login_limits where attempt_key = p_key;
    return true;
  end if;
  next_attempts := case when current_limit.window_started_at is null or current_limit.window_started_at < now() - interval '15 minutes' then 1 else current_limit.attempts + 1 end;
  insert into access_login_limits(attempt_key, attempts, window_started_at, blocked_until, updated_at)
  values(p_key, next_attempts, case when next_attempts = 1 then now() else current_limit.window_started_at end, case when next_attempts >= 5 then now() + interval '15 minutes' end, now())
  on conflict(attempt_key) do update set attempts = excluded.attempts, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until, updated_at = excluded.updated_at;
  return next_attempts < 5;
end;
$$;

revoke all on function public.access_login_attempt(text, boolean) from public, anon, authenticated;
grant execute on function public.access_login_attempt(text, boolean) to service_role;

create or replace function public.enforce_pipeline_budget()
returns trigger
language plpgsql
set search_path = public
as $$
declare purpose text;
begin
  purpose := coalesce(new.parameters->>'purpose', '');
  if purpose in ('automated_batch', 'automated_cloud', 'record_operation') and not (new.parameters ? 'provider_budget_usd') then
    new.parameters := new.parameters || jsonb_build_object(
      'provider_budget_usd',
      case when purpose = 'record_operation' then 0.25 else least(4.00, greatest(0.25, new.selected_count * 0.08)) end
    );
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_pipeline_budget on public.pipeline_runs;
create trigger enforce_pipeline_budget before insert on public.pipeline_runs
for each row execute function public.enforce_pipeline_budget();

update public.pipeline_runs
set parameters = parameters || jsonb_build_object(
  'provider_budget_usd',
  case when parameters->>'purpose' = 'record_operation' then 0.25 else least(4.00, greatest(0.25, selected_count * 0.08)) end
)
where coalesce(parameters->>'purpose', '') in ('automated_batch', 'automated_cloud', 'record_operation')
  and not (parameters ? 'provider_budget_usd');

comment on table public.access_login_limits is 'Comptadors temporals d’accés identificats només per una empremta HMAC; no conserva IPs.';
comment on function public.enforce_pipeline_budget() is 'Assigna un sostre preventiu de cost a qualsevol lot o operació individual nova.';
