alter table public.record_units add column if not exists horizon_state text
 check(horizon_state in ('in_scope','pre_2024_origin_unavailable','out_of_scope','undetermined'));
