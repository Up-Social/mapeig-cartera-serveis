do $$
declare typ text;sid uuid;run uuid;j uuid;v text;code text;accept_id uuid;reopen_id uuid;d uuid;correction_id uuid;revision text;path text;sha text:=repeat('c',64);before_cost bigint;
begin
 select id into strict v from catalog_versions where active and validated;
 select service_code into code from eligible_official_services where version_id=v limit 1;
 select count(*) into before_cost from provider_calls;
 foreach typ in array array['concert','contractacio','conveni','subvencio'] loop
  sid:=gen_random_uuid();accept_id:=gen_random_uuid();reopen_id:=gen_random_uuid();correction_id:=gen_random_uuid();
  insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type,provider_name,source_payload) values(sid,case typ when 'concert' then 'concerts' when 'contractacio' then 'contractacions' when 'conveni' then 'convenis' else 'raisc_ccaa' end,sid::text,'Test','Cas aïllat de revisió',typ,'Original immutable','{"original":"immutable"}');
  insert into pipeline_runs default values returning id into run;
  insert into pipeline_jobs(run_id,source_record_id,status) values(run,sid,'needs_review') returning id into j;
  insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence)
   values(j,sid,v,'test','out_of_portfolio','[]','Una proposta automàtica de prova que no determina cap validació humana.','Servei','Destinataris','[{"content":"fixture"}]');
  if typ='concert' then
   if (select classification from analysis_results where pipeline_job_id=j)<>'insufficient_evidence' then raise exception 'TEST: concert outside survived';end if;
   begin
    perform review_analysis(sid,'outside',j,'{}',null,null,'Fora de cartera no permès per concerts');
    raise exception 'TEST: concert outside review accepted';
   exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
  else
   perform review_analysis(sid,'outside',j,'{}',null,null,'Decisió de prova de fora de cartera');
   perform review_analysis(sid,'insufficient',j,'{}',null,null,'Es revisa la documentació de prova');
  end if;
  perform record_reservation(sid,j,accept_id,null,'accept','Reserva provisional de prova','Falta confirmar el servei prestat','Revisor de proves');
  perform record_reservation(sid,j,accept_id,null,'accept','Reserva provisional de prova','Falta confirmar el servei prestat','Revisor de proves');
  if (select count(*) from record_reservation_events where source_record_id=sid)<>1 then raise exception 'TEST: duplicate reservation';end if;
  if (select destination from current_record_results where id=sid)<>'reserved' then raise exception 'TEST: reservation still in ordinary queue';end if;
  if (select review_state from imported_record_processing_overview where id=sid)<>'reserved' then raise exception 'TEST: missing reserve filter';end if;
  if exists(select 1 from current_issue_results where id=sid) or exists(select 1 from service_provisions where source_record_id=sid) then raise exception 'TEST: reserve counted as issue or financing';end if;
  begin
   perform review_analysis(sid,'select',j,'{}',null,code,'Intent d’aprovar sense reobrir');raise exception 'TEST: approved reserved record';
  exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
  update pipeline_jobs set status='error',error_message='Nou error tècnic' where id=j;
  if (select destination from current_record_results where id=sid)<>'issues' then raise exception 'TEST: technical error hidden';end if;
  update pipeline_jobs set status='needs_review',error_message=null where id=j;
  begin
   perform record_reservation(sid,j,gen_random_uuid(),null,'reopen','Reobertura obsoleta de prova','','Revisor de proves');raise exception 'TEST: stale accepted';
  exception when serialization_failure then null;end;
  perform record_reservation(sid,j,reopen_id,accept_id,'reopen','Reobertura documentada de prova','','Revisor de proves');
  if (select count(*) from record_reservation_events where source_record_id=sid)<>2 then raise exception 'TEST: history lost';end if;
  if (select destination from current_record_results where id=sid)='reserved' then raise exception 'TEST: reopen failed';end if;
  path:='cases/'||sid||'/documents/'||gen_random_uuid()||'/'||sha||'.pdf';
  insert into source_documents(source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256)
   values(sid,'https://example.invalid/'||sid||'.pdf',sid::text,'annex','fetched','application/pdf','Text acreditat de prova sobre el servei i els destinataris.',path,sha) returning id into d;
  insert into storage.objects(bucket_id,name) values('cloud-documents',path);
  select storage_sha256||':'||coalesce(active_extraction_id::text,'') into revision from source_documents where id=d;
  perform save_documented_correction(sid,j,correction_id,null,null,'provider_name','Entitat acreditada',d,revision,1,'Text acreditat de prova sobre el servei',false,'Correcció acreditada amb el document','Revisor de proves');
  perform save_documented_correction(sid,j,correction_id,null,null,'provider_name','Entitat acreditada',d,revision,1,'Text acreditat de prova sobre el servei',false,'Correcció acreditada amb el document','Revisor de proves');
  if (select count(*) from documented_corrections where source_record_id=sid)<>1 then raise exception 'TEST: duplicate correction';end if;
  if (select provider_name from source_records where id=sid)<>'Original immutable' then raise exception 'TEST: original overwritten';end if;
  begin
   perform save_documented_correction(sid,j,gen_random_uuid(),correction_id,null,'provider_name','Invalid',d,revision,1,'Aquesta cita no es troba en el document',false,'Cita no contrastada de prova','Revisor de proves');raise exception 'TEST: invalid literal quote accepted';
  exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
  -- Changed bytes invalidate the correction; an explicit fresh observation restores it.
  update source_documents set storage_sha256=repeat('d',64),storage_path=replace(path,sha,repeat('d',64)) where id=d;
  insert into storage.objects(bucket_id,name) values('cloud-documents',replace(path,sha,repeat('d',64)));
  if (select valid from current_documented_corrections where id=correction_id) then raise exception 'TEST: stale document trusted';end if;
  begin
   perform review_analysis(sid,'select',j,'{}',null,code,'Aprovació amb font canviada');raise exception 'TEST: stale source approved';
  exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
  perform save_documented_correction(sid,j,gen_random_uuid(),correction_id,null,'provider_name','Entitat acreditada',d,(select storage_sha256||':'||coalesce(active_extraction_id::text,'') from source_documents where id=d),1,'Comprovació visual directa de l’entitat',true,'Nova comprovació visual documentada','Revisor de proves');
  perform review_analysis(sid,'select',j,'{}',null,code,'Aprovació amb evidència revisada');
  if (select provider_name from service_provisions where source_record_id=sid and superseded_at is null)<>'Entitat acreditada' then raise exception 'TEST: human correction not used at approval';end if;
  begin
   perform record_reservation(sid,j,gen_random_uuid(),reopen_id,'accept','Intent de retirar una aprovació','Import ja aprovat anteriorment','Revisor de proves');raise exception 'TEST: approved funding silently reserved';
  exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 end loop;
 if (select count(*) from provider_calls)<>before_cost then raise exception 'TEST: human completion incurred provider calls';end if;
end $$;
