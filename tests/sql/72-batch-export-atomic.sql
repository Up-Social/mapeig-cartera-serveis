create function pg_temp.fail_export_item() returns trigger language plpgsql as $$
begin raise exception 'synthetic export item failure';end $$;

do $$
declare run_ uuid; other_run uuid; source_ uuid:=gen_random_uuid(); provision_ uuid; receipt_ uuid; version_ text; code_ text; before_ bigint;
begin
 insert into public.pipeline_runs default values returning id into run_;
 insert into public.source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
 values(source_,'contractacions',source_::text,'Contractació','Export fixture','{}'::jsonb);
 insert into public.pipeline_jobs(run_id,source_record_id,status) values(run_,source_,'queued');
 select id into strict version_ from public.catalog_versions where active and validated limit 1;
 select service_code into strict code_ from public.eligible_official_services where version_id=version_ limit 1;
 insert into public.service_provisions(source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id)
 values(source_,source_::text,'Contractació','fixture',code_,version_) returning id into provision_;
 receipt_:=public.record_batch_export(run_,'fixture.xlsx',repeat('a',64),array[provision_]);
 if not exists(select 1 from public.excel_exports where id=receipt_ and pipeline_run_id=run_ and provision_count=1 and content_hash=repeat('a',64))
  or (select count(*) from public.excel_export_items where export_id=receipt_ and provision_id=provision_)<>1
 then raise exception 'TEST: receipt or item missing';end if;
 select count(*) into before_ from public.excel_exports;
 begin
  perform public.record_batch_export(run_,'failed.xlsx',repeat('b',64),array[provision_,gen_random_uuid()]);
  raise exception 'TEST: missing provision accepted';
 exception when serialization_failure then null;end;
 if (select count(*) from public.excel_exports)<>before_ or exists(select 1 from public.excel_exports where filename='failed.xlsx')
 then raise exception 'TEST: failed export left a header';end if;
 insert into public.pipeline_runs default values returning id into other_run;
 begin
  perform public.record_batch_export(other_run,'wrong-run.xlsx',repeat('e',64),array[provision_]);
  raise exception 'TEST: unrelated provision accepted';
 exception when serialization_failure then null;end;
 if (select count(*) from public.excel_exports)<>before_ then raise exception 'TEST: unrelated export left a header';end if;
 -- Force failure only after the header insert to prove transaction rollback.
 execute 'create trigger test_export_item_failure before insert on public.excel_export_items for each row execute function pg_temp.fail_export_item()';
 begin
  perform public.record_batch_export(run_,'item-error.xlsx',repeat('f',64),array[provision_]);
  raise exception 'TEST: item trigger did not run';
 exception when raise_exception then if sqlerrm<>'synthetic export item failure' then raise;end if;end;
 execute 'drop trigger test_export_item_failure on public.excel_export_items';
 if (select count(*) from public.excel_exports)<>before_ or exists(select 1 from public.excel_exports where filename='item-error.xlsx')
 then raise exception 'TEST: item failure left a header';end if;
 begin
  perform public.record_batch_export(run_,'duplicate.xlsx',repeat('c',64),array[provision_,provision_]);
  raise exception 'TEST: duplicate provision accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 if (select count(*) from public.excel_exports)<>before_ then raise exception 'TEST: duplicate export left a header';end if;
 update public.service_provisions set superseded_at=now() where id=provision_;
 begin
  perform public.record_batch_export(run_,'stale.xlsx',repeat('d',64),array[provision_]);
  raise exception 'TEST: stale provision accepted';
 exception when serialization_failure then null;end;
 if (select count(*) from public.excel_exports)<>before_ then raise exception 'TEST: stale export left a header';end if;
 if has_function_privilege('authenticated','public.record_batch_export(uuid,text,text,uuid[])','execute')
  or not has_function_privilege('service_role','public.record_batch_export(uuid,text,text,uuid[])','execute')
 then raise exception 'TEST: export receipt grants';end if;
end $$;
