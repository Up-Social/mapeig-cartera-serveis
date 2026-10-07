alter table public.record_units drop constraint if exists record_units_act_type_check;
alter table public.record_units add constraint record_units_act_type_check
 check(act_type in ('legacy','award','renewal','amendment','termination','modification','cession','appeal','validation'));
