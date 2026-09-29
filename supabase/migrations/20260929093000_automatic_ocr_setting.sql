create table public.app_settings (
  key text primary key,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  constraint app_settings_known_key check (key in ('automatic_ocr'))
);

alter table public.app_settings enable row level security;
revoke all on public.app_settings from public, anon, authenticated;
grant select, insert, update on public.app_settings to service_role;

insert into public.app_settings (key, enabled)
values ('automatic_ocr', true)
on conflict (key) do nothing;

create function public.apply_automatic_ocr_setting()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  ocr_enabled boolean := true;
begin
  if new.parameters ? 'ocr_recovery' then
    return new;
  end if;

  if coalesce(new.parameters->>'auto_process', 'false') <> 'true'
    or coalesce(new.parameters->>'purpose', '') not in ('automated_batch', 'comparison') then
    return new;
  end if;

  select enabled into ocr_enabled
  from public.app_settings
  where key = 'automatic_ocr';

  new.parameters := new.parameters || jsonb_build_object(
    'ocr_recovery', coalesce(ocr_enabled, true),
    'ocr_setting', 'automatic_ocr'
  );
  return new;
end;
$$;

revoke all on function public.apply_automatic_ocr_setting() from public, anon, authenticated;

create trigger apply_automatic_ocr_setting
before insert on public.pipeline_runs
for each row execute function public.apply_automatic_ocr_setting();

-- Re-enable OCR for unfinished automatic batches created before this setting
-- existed. This does not enqueue, resume or otherwise execute those batches.
update public.pipeline_runs
set parameters = parameters || jsonb_build_object(
  'ocr_recovery', true,
  'ocr_setting', 'automatic_ocr_migration_default'
)
where coalesce(parameters->>'auto_process', 'false') = 'true'
  and coalesce(parameters->>'purpose', '') in ('automated_batch', 'comparison')
  and not (parameters ? 'ocr_recovery')
  and status in ('draft', 'queued', 'preparing', 'ready', 'enriching', 'matching', 'paused');

comment on table public.app_settings is
  'Configuració operativa administrable. automatic_ocr s’aplica com una instantània als lots nous.';

comment on function public.apply_automatic_ocr_setting() is
  'Copia el valor administratiu d’OCR als paràmetres immutables de cada lot automàtic nou.';
