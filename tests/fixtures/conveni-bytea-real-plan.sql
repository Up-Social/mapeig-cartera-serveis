do $$
declare
 r uuid:=gen_random_uuid();j uuid:=gen_random_uuid();run_ uuid:=gen_random_uuid();d uuid:=gen_random_uuid();u uuid;
 draft uuid:=gen_random_uuid();attempt uuid:=gen_random_uuid();op uuid:=gen_random_uuid();event_ uuid:=gen_random_uuid();
 v text;code text;path_ text;rev text;proposal jsonb;bundle jsonb;cit jsonb;digest_ text:=encode(extensions.digest(convert_to('synthetic','utf8'),'sha256'),'hex');
 txt text:='La Fundació de prova amb NIF G12345678 rep 1.000,00 euros per prestar un servei social a persones grans al municipi de Vic durant 2025.';
 source_ text;plan_ jsonb;first_ jsonb;again_ jsonb; inspect_ jsonb; chunk_ jsonb; assembled_ bytea;
begin
 select id into strict v from public.catalog_versions where active and validated limit 1;
 select service_code into strict code from public.eligible_official_services where version_id=v limit 1;
 insert into public.source_records(id,source_dataset,source_record_id,mechanism,title,amount,source_payload,financing_type)
 values(r,'convenis',r::text,'Conveni','Conveni sintètic',1000,'{"Total aportacions previstes Generalitat":0,"Total aportacions previstes ens locals":1000,"Data signatura":"2025-01-01"}','conveni');
 insert into public.pipeline_runs(id) values(run_);
 insert into public.pipeline_jobs(id,run_id,source_record_id,status) values(j,run_,r,'ready');
 path_:='cases/'||r||'/documents/'||d||'/'||digest_||'.pdf';
 insert into public.source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial,extraction_method)
 values(d,r,'https://fixture.invalid/'||d,d::text,'agreement','fetched','application/pdf','## Pàgina 1'||chr(10)||txt,path_,digest_,length(txt),false,'pdftotext');
 insert into storage.objects(bucket_id,name,version) values('cloud-documents',path_,gen_random_uuid()::text);
 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into rev from public.source_documents where id=d;
 cit:=jsonb_build_object('document_id',d,'page',1,'quote',txt);
 proposal:=jsonb_build_object('key','fundacio de prova|2025','recipient','Fundació de prova','recipient_nif','G12345678','recipient_nature','private','period','2025','year',2025,'amount_cents',100000,'amount_state','conditional','joint',false,'mixed',false,'financiers',jsonb_build_array('Ajuntament'),'territory','Vic','classification','in_portfolio','service_code',code,'population','Gent gran','description','Servei social','explanation','Servei social acreditat','reason',null,'blockers','[]'::jsonb,'evidence',jsonb_build_array(cit));
 bundle:=jsonb_build_object('actors','[]'::jsonb,'units',jsonb_build_array(proposal),'instrument_grant',true,'coverage_complete',true,'unallocated_cents',0,'summary','Anàlisi sintètica');
 perform public.persist_conveni(j,v,bundle,jsonb_build_object(d::text,rev),public.conveni_source_hash(r));
 select unit_id into strict u from public.conveni_unit_proposals where job_id=j;
 perform public.prepare_conveni_unit_economic_draft(r,j,u,draft,null,null,public.conveni_source_hash(r),encode(extensions.digest(proposal::text,'sha256'),'hex'),encode(extensions.digest(bundle::text,'sha256'),'hex'),jsonb_build_object(d::text,rev),code,100000,'1.000,00',cit,cit,cit,'{"public_contribution":true,"recipient_role":true,"period":true,"not_shared_or_maximum":true,"conditions_preserved":true,"not_payment":true}','Atribució documental sintètica');
 insert into public.conveni_first_preparation_operations(id,record_id,job_id,unit_id,payload,ids) values(op,r,j,u,'{}',jsonb_build_object('draftId',draft));
 insert into conveni_preparation_guard_candidate.attempts(id,record_id,job_id,unit_id,mode,first_operation_id,state) values(attempt,r,j,u,'first',op,'active');
 update conveni_preparation_guard_candidate.config set enabled=true where singleton;
 plan_:=conveni_preparation_guard_candidate.step(attempt,'copy_plan',null);
 if jsonb_array_length(plan_->'archives')<>1 or plan_->'archives'->0->'source'->>'sha256'<>digest_ then raise exception 'REAL_PLAN_INVALID';end if;
 if conveni_transactional_bytes_candidate.same_source_plan(plan_,jsonb_set(plan_,'{archives,0,copyPath}',to_jsonb('other'::text)))
  or conveni_transactional_bytes_candidate.same_source_plan(plan_,jsonb_set(plan_,'{archives,0,source,version}',to_jsonb(gen_random_uuid()::text)))
  or conveni_transactional_bytes_candidate.same_source_plan(plan_,jsonb_set(plan_,'{archives,0,source,object_id}',to_jsonb(gen_random_uuid()::text)))
  or conveni_transactional_bytes_candidate.same_source_plan(plan_,jsonb_set(plan_,'{monetaryCitation,quote}',to_jsonb('different quote'::text)))
  or conveni_transactional_bytes_candidate.same_source_plan(plan_,jsonb_set(plan_,'{draftId}',to_jsonb(gen_random_uuid()::text)))
  or conveni_transactional_bytes_candidate.same_source_plan(plan_,jsonb_set(plan_,'{recordId}',to_jsonb(gen_random_uuid()::text)))
  or conveni_transactional_bytes_candidate.same_source_plan(plan_,'{"archives":[]}'::jsonb)
  or conveni_transactional_bytes_candidate.same_source_plan(plan_,'{"archives":{}}'::jsonb) then raise exception 'INSECURE_PLAN_COMPARISON';end if;
 first_:=conveni_transactional_bytes_candidate.capture_plan(r,j,u,attempt);
 if first_->>'replay'<>'false' then raise exception 'CAPTURE_INVALID';end if;
 if (select plan from conveni_transactional_bytes_candidate.plans where attempt_id=attempt) is distinct from plan_ then raise exception 'CAPTURE_DIFFERS_FROM_REAL_PLAN';end if;
 again_:=conveni_transactional_bytes_candidate.commit_batch(r,j,u,attempt,event_,jsonb_build_array(jsonb_build_object('documentId',d,'base64',encode(convert_to('synthetic','utf8'),'base64'))));
 if again_->>'historicalReplay'<>'false' then raise exception 'COMMIT_INVALID';end if;
 if (select observed_mime_type from conveni_transactional_bytes_candidate.items where event_id=event_ and document_id=d) is distinct from 'application/pdf' then raise exception 'MIME_OBSERVATION_INVALID';end if;
 again_:=conveni_transactional_bytes_candidate.verify_batch(r,j,u,attempt,event_);
 if again_->>'bytesVerified'<>'true' or again_->>'sourceMetadataMatches'<>'true' or again_->>'physicalSourceVerified'<>'false' or again_->>'current'<>'false' or again_->>'state'<>'pending_reconciliation' or again_->>'documents'<>'1' then raise exception 'REAL_BATCH_VERIFICATION_INVALID';end if;
 chunk_:=conveni_transactional_bytes_candidate.read_chunk(r,j,u,attempt,event_,d,0,4);
 if chunk_->>'offset'<>'0' or chunk_->>'totalBytes'<>'9' or chunk_->>'sha256'<>digest_ or chunk_->>'observedMimeType'<>'application/pdf' or chunk_->>'current'<>'false' or chunk_->>'physicalSourceVerified'<>'false' then raise exception 'CHUNK_METADATA_INVALID';end if;
 assembled_:=decode(chunk_->>'base64','base64');
 chunk_:=conveni_transactional_bytes_candidate.read_chunk(r,j,u,attempt,event_,d,4,262144);
 assembled_:=assembled_||decode(chunk_->>'base64','base64');
 if assembled_ is distinct from convert_to('synthetic','utf8') then raise exception 'CHUNK_RECONSTRUCTION_INVALID';end if;
 chunk_:=conveni_transactional_bytes_candidate.read_chunk(r,j,u,attempt,event_,d,9,1);
 if octet_length(decode(chunk_->>'base64','base64'))<>0 then raise exception 'CHUNK_END_INVALID';end if;
 begin perform conveni_transactional_bytes_candidate.read_chunk(r,j,u,attempt,event_,d,10,1);raise exception 'CHUNK_OUT_OF_BOUNDS_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_RANGE_INVALID' then raise;end if;end;
 inspect_:=conveni_transactional_bytes_candidate.inspect_attempt(r,j,u,attempt);
 if inspect_->>'eventId'<>event_::text or inspect_->>'current'<>'false' then raise exception 'INSPECT_INVALID';end if;
 -- An unrelated legacy unit-copy can appear while the retained bytea source
 -- and the guarded draft are identical. It must not invalidate this batch.
 begin
  insert into storage.objects(bucket_id,name,version) values('cloud-documents',plan_->'archives'->0->>'copyPath',gen_random_uuid()::text);
  again_:=conveni_transactional_bytes_candidate.capture_plan(r,j,u,attempt);
  if again_->>'replay'<>'true' then raise exception 'LEGACY_COPY_CAPTURE_INVALID';end if;
  again_:=conveni_transactional_bytes_candidate.verify_batch(r,j,u,attempt,event_);
  if again_->>'bytesVerified'<>'true' or again_->>'physicalSourceVerified'<>'false' then raise exception 'LEGACY_COPY_VERIFICATION_INVALID';end if;
  raise exception 'ROLLBACK_LEGACY_COPY_FIXTURE';
 exception when raise_exception then if sqlerrm<>'ROLLBACK_LEGACY_COPY_FIXTURE' then raise;end if;end;
 begin
  update storage.objects set version=gen_random_uuid()::text where name=path_;
  perform conveni_transactional_bytes_candidate.capture_plan(r,j,u,attempt);
  raise exception 'STALE_PLAN_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_PLAN_CHANGED' then raise;end if;end;
 begin
  update storage.objects set version=gen_random_uuid()::text where name=path_;
  perform conveni_transactional_bytes_candidate.read_chunk(r,j,u,attempt,event_,d,0,4);
  raise exception 'STALE_BATCH_VERIFICATION_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_PLAN_CHANGED' then raise;end if;end;
 begin
  update public.source_documents set mime_type='text/plain' where id=d;
  perform conveni_transactional_bytes_candidate.verify_batch(r,j,u,attempt,event_);
  raise exception 'CHANGED_MIME_ACCEPTED';
 exception when others then if sqlerrm<>'Cobertura documental canviada' then raise;end if;end;
 if (select observed_mime_type from conveni_transactional_bytes_candidate.items where event_id=event_ and document_id=d) is distinct from 'application/pdf' then raise exception 'MIME_HISTORY_CHANGED';end if;
 again_:=conveni_transactional_bytes_candidate.verify_batch(r,j,u,attempt,event_);
 if again_->>'bytesVerified'<>'true' or again_->>'current'<>'false' then raise exception 'VERIFICATION_AFTER_ROLLBACK_INVALID';end if;
 begin update conveni_preparation_guard_candidate.attempts set state='complete' where id=attempt;raise exception 'READY_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_DECISION_NOT_INTEGRATED' then raise;end if;end;
 if exists(select 1 from public.service_provisions where source_record_id=r) then raise exception 'FINANCING_UNEXPECTED';end if;
 raise notice 'PASS real 730 copy_plan, capture, hash-verified batch, retained historical inspection, source metadata revision blocks capture, 730 completion blocked';
end $$;
