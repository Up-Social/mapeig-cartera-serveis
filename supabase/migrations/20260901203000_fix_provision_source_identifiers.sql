update public.service_provisions provision
set source_id = coalesce(
  nullif(record.source_payload->>'Código del expediente', ''),
  nullif(record.source_payload->>'Número conveni definitiu', ''),
  nullif(record.source_payload->>'Clau', ''),
  nullif(record.source_payload->>'registre', ''),
  split_part(record.source_record_id, '::', 1)
),
call_url = coalesce(
  nullif(provision.call_url, ''),
  nullif(record.source_payload->>'Enlace de la última publicación', ''),
  nullif(record.source_payload->>'Document conveni', ''),
  nullif(record.source_payload->>'Enllaç convocatòria', '')
),
updated_at = now()
from public.source_records record
where record.id = provision.source_record_id;

comment on column public.service_provisions.source_id is
  'Identificador oficial del registre d’origen, sense sufixos tècnics de deduplicació.';
