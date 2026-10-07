-- Archiving an unchanged source document only adds a Storage pointer. It must not
-- manufacture a historical job snapshot of an extraction that did not change.
create or replace function public.snapshot_before_projection_change() returns trigger
language plpgsql set search_path=public as $$
declare job uuid;
begin
 if tg_table_name='source_documents'
    and (to_jsonb(new)-'storage_path'-'storage_sha256'-'storage_captured_at')
      = (to_jsonb(old)-'storage_path'-'storage_sha256'-'storage_captured_at')
 then return new;end if;
 select id into job from pipeline_jobs where source_record_id=old.source_record_id order by created_at desc,id desc limit 1;
 if job is not null then perform capture_job_snapshot(job,'before_'||tg_table_name||'_change');end if;
 return new;
end $$;
