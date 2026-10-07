alter table public.record_units
 add column if not exists municipality text,
 add column if not exists origin_reference text;
