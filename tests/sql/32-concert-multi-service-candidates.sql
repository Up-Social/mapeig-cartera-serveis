do $$
declare sid uuid:=gen_random_uuid();rid uuid;j uuid;d uuid;chunk_id uuid;v text;code text;codes text[];n int:=0;
 digest text:=repeat('c',64);doc_path text;body text:=repeat('Evidència documental de la resolució i els serveis socials acreditats. ',8);
 candidates jsonb:='[]';ev jsonb;result jsonb;unproven jsonb;
begin
 select id into strict v from catalog_versions where active and validated;
 select array_agg(service_code) into codes from (select service_code from official_services where version_id=v and benefit_type='service' order by service_code limit 5) s;
 if coalesce(array_length(codes,1),0)<5 then raise exception 'Fixture requires five catalog services';end if;
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values(sid,'concerts','MULTI-'||sid,'Concert','Resolució de prova','concert');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'matching') returning id into j;
 doc_path:='cases/'||sid||'/documents/'||gen_random_uuid()||'/'||digest||'.pdf';
 insert into source_documents(source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,text_length,storage_path,storage_sha256,extraction_version,extraction_method)
 values(sid,'https://example.invalid/multi.pdf','multi-test','annex','fetched','application/pdf',body,length(body),doc_path,digest,'readable-markdown-v4','pdf-text') returning id into d;
 perform replace_document_chunks(d,jsonb_build_array(jsonb_build_object('ordinal',0,'content',body,'content_hash','multi')),jsonb_build_object('quality_flags','[]'::jsonb,'quality_score',1));
 select id into strict chunk_id from current_evidence_chunks where source_document_id=d;
 ev:=jsonb_build_array(jsonb_build_object('id',chunk_id,'content',body));
 insert into concert_annex_reconciliations(source_record_id,document_id,document_sha256,extraction_version,annex,row_count,sum_cents,declared_cents,reconciled)
 values(sid,d,digest,'readable-markdown-v4',6,4,400,400,true);
 foreach code in array codes[1:4] loop
  n:=n+1;
  insert into record_units(source_record_id,unit_key,document_id,storage_path,storage_sha256,observed_service_code,extraction_origin,status)
  values(sid,'test-unit-'||n,d,'cases/'||sid||'/items/'||gen_random_uuid()||'/documents/'||d||'/'||digest||'.pdf',digest,code,'official-annex-v1','draft');
  candidates:=candidates||jsonb_build_array(jsonb_build_object('code',code,'score',1,'rationale','Codi documentat','model','fixture','metadata','{}'::jsonb,'evidence',ev,'evidence_explanation','Font documental'));
 end loop;
 result:=jsonb_build_object('classification','in_portfolio','reasons','[]'::jsonb,'explanation','Serveis documentats','service_description','Serveis','target_population','Persones','rule_audit',jsonb_build_object('version','concert-reconciled-annex-v1'));
 begin
  perform persist_analysis(j,v,result||jsonb_build_object('rule_audit',jsonb_build_object('version','generic')),candidates,ev);
  raise exception 'Generic analysis accepted four candidates';
 exception when raise_exception then if sqlerrm='Generic analysis accepted four candidates' then raise;end if;end;
 unproven:=jsonb_set(candidates,'{3,code}',to_jsonb(codes[5]));
 begin
  perform persist_analysis(j,v,result,unproven,ev);
  raise exception 'Undocumented concert code accepted';
 exception when raise_exception then if sqlerrm='Undocumented concert code accepted' then raise;end if;end;
 update source_records set financing_type='conveni' where id=sid;
 begin
  perform persist_analysis(j,v,result,candidates,ev);
  raise exception 'Non-concert analysis accepted four candidates';
 exception when raise_exception then if sqlerrm='Non-concert analysis accepted four candidates' then raise;end if;end;
 update source_records set financing_type='concert' where id=sid;
 perform persist_analysis(j,v,result,candidates,ev);
 if (select count(*) from matching_candidates where pipeline_job_id=j)<>4 then raise exception 'Four documented candidates not persisted';end if;
 if exists(select 1 from service_provisions where source_record_id=sid) then raise exception 'Analysis created an approved provision';end if;
end $$;
