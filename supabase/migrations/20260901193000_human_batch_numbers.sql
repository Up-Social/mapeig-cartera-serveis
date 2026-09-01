create sequence public.pipeline_run_number_seq
  as bigint minvalue 0 start with 0 increment by 1;

alter table public.pipeline_runs add column batch_number bigint;

with numbered as (
  select id, row_number() over (order by created_at, id) - 1 as value
  from public.pipeline_runs
)
update public.pipeline_runs run
set batch_number = numbered.value
from numbered
where numbered.id = run.id;

select setval(
  'public.pipeline_run_number_seq',
  coalesce((select max(batch_number) from public.pipeline_runs), 0),
  exists(select 1 from public.pipeline_runs)
);

alter table public.pipeline_runs
  alter column batch_number set default nextval('public.pipeline_run_number_seq'),
  alter column batch_number set not null,
  add constraint pipeline_runs_batch_number_unique unique(batch_number),
  add constraint pipeline_runs_batch_number_nonnegative check(batch_number >= 0);

grant usage, select on sequence public.pipeline_run_number_seq to service_role;

comment on column public.pipeline_runs.batch_number is
  'Identificador humà seqüencial, mostrat amb vuit dígits; l’UUID continua sent la clau tècnica.';
