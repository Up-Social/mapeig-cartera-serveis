do $$
declare
  first_run uuid;
  second_run uuid;
begin
  if not coalesce((select enabled from app_settings where key = 'automatic_ocr'), false) then
    raise exception 'Automatic OCR must be enabled by default';
  end if;

  insert into source_records (
    id, source_dataset, source_record_id, mechanism, title, financing_type,
    deduplication_key, source_payload, processing_status
  ) values
    ('aaaaaaaa-0000-4000-8000-000000000091', 'contractacions', 'OCR-SETTING-ON', 'Contractació', 'OCR activat', 'contractacio', 'ocr-setting-on', '{}', 'pendent'),
    ('aaaaaaaa-0000-4000-8000-000000000092', 'contractacions', 'OCR-SETTING-OFF', 'Contractació', 'OCR desactivat', 'contractacio', 'ocr-setting-off', '{}', 'pendent');

  first_run := create_automated_batch(1);
  if coalesce((select (parameters->>'ocr_recovery')::boolean from pipeline_runs where id = first_run), false) is not true then
    raise exception 'New automatic batch did not snapshot enabled OCR';
  end if;

  update app_settings set enabled = false, updated_at = now() where key = 'automatic_ocr';
  second_run := create_automated_batch(1);
  if coalesce((select (parameters->>'ocr_recovery')::boolean from pipeline_runs where id = second_run), true) is not false then
    raise exception 'New automatic batch did not snapshot disabled OCR';
  end if;

  if coalesce((select (parameters->>'ocr_recovery')::boolean from pipeline_runs where id = first_run), false) is not true then
    raise exception 'Changing the setting modified an existing batch';
  end if;
end $$;
