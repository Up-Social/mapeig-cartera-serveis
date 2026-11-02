-- Only in the networkless fixture. Preserve the signature and deliberately
-- substitute the expensive guarded copy-plan producer with synthetic input.
create or replace function conveni_preparation_guard_candidate.step(p_attempt uuid,p_action text,p_value jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if p_action is distinct from 'copy_plan' then raise exception 'FIXTURE_UNSUPPORTED';end if;
 return current_setting('fixture.plan',true)::jsonb;
end $$;

create function pg_temp.clean_discard() returns jsonb language plpgsql as $$
declare r uuid:=gen_random_uuid();j uuid;run_ uuid;v text;result jsonb;
begin
 insert into public.source_records(id,source_dataset,source_record_id,mechanism,title) values(r,'contractacions',r::text,'Contractació','Fictici');
 insert into public.pipeline_runs default values returning id into run_;
 insert into public.pipeline_jobs(run_id,source_record_id,status,preparation_status) values(run_,r,'ready','ready') returning id into j;
 select id into v from public.catalog_versions where active and validated limit 1;
 perform public.persist_analysis(j,v,'{"classification":"discarded","reasons":["individual_grant"],"explanation":"Descarte ficticio","service_description":"Fixture","target_population":"Fixture"}','[]','[{"content":"fixture"}]');
 select jsonb_build_object('id',id,'job_id',job_id,'result_token',result_token) into result from public.current_record_results where id=r;
 if result is null then raise exception 'FIXTURE_DISCARD_MISSING';end if;
 return result;
end $$;

do $$
declare
 r uuid:='00000000-0000-4000-8000-000000000101';
 j uuid:='00000000-0000-4000-8000-000000000102';
 u uuid:='00000000-0000-4000-8000-000000000103';
 a uuid:='00000000-0000-4000-8000-000000000104';
 o uuid:='00000000-0000-4000-8000-000000000105';
 e uuid:='00000000-0000-4000-8000-000000000106';
 d1 uuid:='00000000-0000-4000-8000-000000000107';
 d2 uuid:='00000000-0000-4000-8000-000000000108';
 run_ uuid:='00000000-0000-4000-8000-000000000109';
 u2 uuid:='00000000-0000-4000-8000-000000000110';
 a2 uuid:='00000000-0000-4000-8000-000000000111';
 o2 uuid:='00000000-0000-4000-8000-000000000112';
 digest_ text:=encode(extensions.digest(convert_to('synthetic','utf8'),'sha256'),'hex');
 plan_ jsonb;items_ jsonb; result_ jsonb; protected_ jsonb;clean_ jsonb;purges_ bigint; big_ bytea; big_hash_ text; big_plan_ jsonb; chunk_ jsonb; reconstructed_ bytea;
begin
 insert into public.source_records(id,source_dataset,source_record_id,mechanism,title,financing_type,suggested_code,suggested_name,suggested_confidence,suggested_evidence)
 values(r,'convenis',r::text,'Conveni','Conveni sintètic','conveni','','',0,'');
 insert into public.pipeline_runs(id) values(run_);
 insert into public.pipeline_jobs(id,run_id,source_record_id,status) values(j,run_,r,'ready');
 insert into public.record_units(id,source_record_id,pipeline_job_id,unit_key) values(u,r,j,'synthetic-unit');
 insert into public.source_documents(id,source_record_id,url,url_hash,document_type) values(d1,r,'https://fixture.invalid/1','hash1','agreement'),(d2,r,'https://fixture.invalid/2','hash2','agreement');
 insert into public.conveni_analyses(job_id,source_record_id,source_hash,payload) values(j,r,'fixture','{}');
 insert into public.conveni_unit_proposals(job_id,unit_id,data) values(j,u,'{}');
 insert into public.conveni_first_preparation_operations(id,record_id,job_id,unit_id,payload,ids) values(o,r,j,u,'{}','{}');
 insert into conveni_preparation_guard_candidate.attempts(id,record_id,job_id,unit_id,mode,first_operation_id,state) values(a,r,j,u,'first',o,'active');
 -- A second attempt is reserved for separate-connection lock tests.
 insert into public.record_units(id,source_record_id,pipeline_job_id,unit_key) values(u2,r,j,'concurrency-unit');
 insert into public.conveni_unit_proposals(job_id,unit_id,data) values(j,u2,'{}');
 insert into public.conveni_first_preparation_operations(id,record_id,job_id,unit_id,payload,ids) values(o2,r,j,u2,'{}','{}');
 insert into conveni_preparation_guard_candidate.attempts(id,record_id,job_id,unit_id,mode,first_operation_id,state) values(a2,r,j,u2,'first',o2,'active');
 update conveni_preparation_guard_candidate.config set enabled=true where singleton;
 clean_:=pg_temp.clean_discard();
 plan_:=jsonb_build_object('archives',jsonb_build_array(jsonb_build_object('documentId',d1,'source',jsonb_build_object('sha256',digest_)),jsonb_build_object('documentId',d2,'source',jsonb_build_object('sha256',digest_))));
 if conveni_transactional_bytes_candidate.same_source_plan(plan_,jsonb_build_object('archives',jsonb_build_array(plan_->'archives'->1,plan_->'archives'->0)))
  or conveni_transactional_bytes_candidate.same_source_plan(plan_,jsonb_build_object('archives',jsonb_build_array(plan_->'archives'->0,plan_->'archives'->0))) then raise exception 'PLAN_ORDER_OR_DUPLICATE_ACCEPTED';end if;
 items_:=jsonb_build_array(jsonb_build_object('documentId',d1,'base64',encode(convert_to('synthetic','utf8'),'base64')),jsonb_build_object('documentId',d2,'base64',encode(convert_to('synthetic','utf8'),'base64')));
 result_:=conveni_transactional_bytes_candidate.inspect_attempt(r,j,u,a);
 if result_->>'planCaptured'<>'false' or result_->>'contractVersion' is not null or result_->>'eventId' is not null or result_->>'state'<>'pending_reconciliation' or result_->>'current'<>'false' or jsonb_array_length(result_->'documents')<>0 then raise exception 'initial inspection invalid';end if;
 begin perform conveni_transactional_bytes_candidate.inspect_attempt(r,(clean_->>'job_id')::uuid,u,a);raise exception 'inspection cross-job accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_SCOPE' then raise;end if;end;
 perform set_config('fixture.plan',plan_::text,true);
 result_:=conveni_transactional_bytes_candidate.capture_plan(r,j,u,a);
 if result_->>'replay'<>'false' then raise exception 'fixture capture';end if;
 result_:=conveni_transactional_bytes_candidate.inspect_attempt(r,j,u,a);
 if result_->>'planCaptured'<>'true' or result_->>'contractVersion'<>'conveni-bytea-manifest-v1' or result_->>'eventId' is not null or result_->>'state'<>'pending_reconciliation' or result_->>'current'<>'false' then raise exception 'plan-only inspection invalid';end if;
 begin perform conveni_transactional_bytes_candidate.verify_batch(r,j,u,a,e);raise exception 'verification without batch accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_BATCH_REQUIRED' then raise;end if;end;
 result_:=conveni_transactional_bytes_candidate.capture_plan(r,j,u,a);
 if result_->>'replay'<>'true' then raise exception 'fixture capture replay';end if;
 begin perform conveni_transactional_bytes_candidate.capture_plan(r,(clean_->>'job_id')::uuid,u,a);raise exception 'cross-job scope accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_SCOPE' then raise;end if;end;
 begin perform conveni_transactional_bytes_candidate.commit_batch((clean_->>'id')::uuid,j,u,a,e,items_);raise exception 'cross-record scope accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_SCOPE' then raise;end if;end;
 perform set_config('fixture.plan',jsonb_set(plan_,'{archives,0,source,sha256}',to_jsonb(repeat('b',64)))::text,true);
 begin perform conveni_transactional_bytes_candidate.capture_plan(r,j,u,a);raise exception 'changed plan accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_PLAN_CHANGED' then raise;end if;end;
 begin perform conveni_transactional_bytes_candidate.commit_batch(r,j,u,a,e,items_);raise exception 'changed plan batch accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_PLAN_CHANGED' then raise;end if;end;
 perform set_config('fixture.plan',plan_::text,true);
 begin update conveni_preparation_guard_candidate.attempts set state='complete' where id=a;raise exception 'legacy completion accepted with plan only';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_DECISION_NOT_INTEGRATED' then raise;end if;end;
 begin perform conveni_transactional_bytes_candidate.capture_plan(r,j,u,'00000000-0000-4000-8000-000000000999');raise exception 'scope accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_SCOPE' then raise;end if;end;
 begin perform conveni_transactional_bytes_candidate.commit_batch(r,j,u,a,e,items_);raise exception 'FIXTURE_ROLLBACK';
 exception when raise_exception then if sqlerrm<>'FIXTURE_ROLLBACK' then raise;end if;end;
 if exists(select 1 from conveni_transactional_bytes_candidate.batches where event_id=e) or exists(select 1 from conveni_transactional_bytes_candidate.items where event_id=e) then raise exception 'partial batch after rollback';end if;
 begin perform conveni_transactional_bytes_candidate.commit_batch(r,j,u,a,e,jsonb_set(items_,'{1,base64}',to_jsonb('d3Jvbmc='::text)));raise exception 'hash accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_HASH' then raise;end if;end;
 if exists(select 1 from conveni_transactional_bytes_candidate.batches where event_id=e) or exists(select 1 from conveni_transactional_bytes_candidate.items where event_id=e) then raise exception 'partial batch after mismatch';end if;
 begin perform conveni_transactional_bytes_candidate.commit_batch(r,j,u,a,e,jsonb_build_array(items_->0,items_->0));raise exception 'duplicate accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_DUPLICATE' then raise;end if;end;
 result_:=conveni_transactional_bytes_candidate.commit_batch(r,j,u,a,e,items_);
 if result_->>'historicalReplay'<>'false' or (select count(*) from conveni_transactional_bytes_candidate.items where event_id=e)<>2 then raise exception 'batch missing';end if;
 if exists(select 1 from conveni_transactional_bytes_candidate.items where event_id=e and observed_mime_type is not null) then raise exception 'UNKNOWN_MIME_INFERRED';end if;
 result_:=conveni_transactional_bytes_candidate.verify_batch(r,j,u,a,e);
 if result_->>'bytesVerified'<>'true' or result_->>'sourceMetadataMatches'<>'true' or result_->>'physicalSourceVerified'<>'false' or result_->>'current'<>'false' or result_->>'state'<>'pending_reconciliation' or result_->>'documents'<>'2' then raise exception 'batch verification invalid';end if;
 result_:=conveni_transactional_bytes_candidate.read_chunk(r,j,u,a,e,d1,0,262144);
 if decode(result_->>'base64','base64') is distinct from convert_to('synthetic','utf8') or result_->>'observedMimeType' is not null or result_->>'current'<>'false' or result_->>'physicalSourceVerified'<>'false' then raise exception 'chunk invalid';end if;
 begin perform conveni_transactional_bytes_candidate.read_chunk(r,(clean_->>'job_id')::uuid,u,a,e,d1,0,1);raise exception 'chunk cross-job accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_SCOPE' then raise;end if;end;
 begin perform conveni_transactional_bytes_candidate.read_chunk(r,j,u,a,e,'00000000-0000-4000-8000-000000000999',0,1);raise exception 'chunk cross-document accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_DOCUMENT' then raise;end if;end;
 begin perform conveni_transactional_bytes_candidate.read_chunk(r,j,u,a,e,d1,-1,1);raise exception 'negative offset accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_RANGE_INVALID' then raise;end if;end;
 begin perform conveni_transactional_bytes_candidate.read_chunk(r,j,u,a,e,d1,0,0);raise exception 'zero length accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_RANGE_INVALID' then raise;end if;end;
 begin perform conveni_transactional_bytes_candidate.read_chunk(r,j,u,a,e,d1,0,262145);raise exception 'oversized chunk accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_RANGE_INVALID' then raise;end if;end;
 -- Exercise an actual 256 KiB chunk, not just the length parameter. Replace
 -- only synthetic data in a subtransaction and roll all tampering back.
 begin
  big_:=decode(repeat('ab',262145),'hex');big_hash_:=encode(extensions.digest(big_,'sha256'),'hex');
  big_plan_:=jsonb_set(plan_,'{archives,0,source,sha256}',to_jsonb(big_hash_));
  alter table conveni_transactional_bytes_candidate.items disable trigger bytes_item_immutable;
  update conveni_transactional_bytes_candidate.items set body=big_,sha256=big_hash_ where event_id=e and document_id=d1;
  alter table conveni_transactional_bytes_candidate.plans disable trigger bytes_plan_immutable;
  update conveni_transactional_bytes_candidate.plans set plan=big_plan_ where attempt_id=a;
  perform set_config('fixture.plan',big_plan_::text,true);
  chunk_:=conveni_transactional_bytes_candidate.read_chunk(r,j,u,a,e,d1,0,262144);
  reconstructed_:=decode(chunk_->>'base64','base64');
  if octet_length(reconstructed_)<>262144 or chunk_->>'totalBytes'<>'262145' then raise exception 'large chunk invalid';end if;
  chunk_:=conveni_transactional_bytes_candidate.read_chunk(r,j,u,a,e,d1,262144,1);
  reconstructed_:=reconstructed_||decode(chunk_->>'base64','base64');
  if reconstructed_ is distinct from big_ then raise exception 'large chunk reconstruction invalid';end if;
  raise exception 'FIXTURE_LARGE_CHUNK_ROLLBACK';
 exception when raise_exception then if sqlerrm<>'FIXTURE_LARGE_CHUNK_ROLLBACK' then raise;end if;end;
 -- Adversarial corruption exists only inside a rolled-back subtransaction in
 -- this networkless synthetic database. Production guards are not modified.
 begin
  alter table conveni_transactional_bytes_candidate.items disable trigger bytes_item_immutable;
  update conveni_transactional_bytes_candidate.items set body=convert_to('tampered','utf8') where event_id=e and document_id=d1;
  perform conveni_transactional_bytes_candidate.verify_batch(r,j,u,a,e);raise exception 'tampered body accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_HASH' then raise;end if;end;
 begin
  alter table conveni_transactional_bytes_candidate.items disable trigger bytes_item_immutable;
  delete from conveni_transactional_bytes_candidate.items where event_id=e and document_id=d1;
  perform conveni_transactional_bytes_candidate.verify_batch(r,j,u,a,e);raise exception 'missing item accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_INCOMPLETE' then raise;end if;end;
 begin
  alter table conveni_transactional_bytes_candidate.plans disable trigger bytes_plan_immutable;
  update conveni_transactional_bytes_candidate.plans set plan='{"archives":[]}'::jsonb where attempt_id=a;
  perform set_config('fixture.plan','{"archives":[]}',true);
  perform conveni_transactional_bytes_candidate.verify_batch(r,j,u,a,e);raise exception 'empty plan accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_PLAN_INVALID' then raise;end if;end;
 if (select count(*) from conveni_transactional_bytes_candidate.items where event_id=e)<>2 or not exists(select 1 from pg_trigger where tgrelid='conveni_transactional_bytes_candidate.items'::regclass and tgname='bytes_item_immutable' and tgenabled='O') then raise exception 'tamper rollback incomplete';end if;
 if not exists(select 1 from pg_trigger where tgrelid='conveni_transactional_bytes_candidate.plans'::regclass and tgname='bytes_plan_immutable' and tgenabled='O') then raise exception 'plan tamper rollback incomplete';end if;
 begin perform conveni_transactional_bytes_candidate.verify_batch(r,(clean_->>'job_id')::uuid,u,a,e);raise exception 'verification cross-job accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_SCOPE' then raise;end if;end;
 perform set_config('fixture.plan',jsonb_set(plan_,'{archives,0,source,sha256}',to_jsonb(repeat('b',64)))::text,true);
 begin perform conveni_transactional_bytes_candidate.verify_batch(r,j,u,a,e);raise exception 'verification accepted changed plan';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_PLAN_CHANGED' then raise;end if;end;
 perform set_config('fixture.plan',plan_::text,true);
 result_:=conveni_transactional_bytes_candidate.inspect_attempt(r,j,u,a);
 if result_->>'eventId'<>e::text or result_->>'contractVersion'<>'conveni-bytea-manifest-v1' or result_->>'state'<>'pending_reconciliation' or result_->>'current'<>'false' or result_->>'attemptState'<>'active'
  or jsonb_array_length(result_->'documents')<>2 or result_::text like '%c3ludGhldGlj%' or result_::text not like '%'||digest_||'%' then raise exception 'batch inspection invalid';end if;
 result_:=conveni_transactional_bytes_candidate.commit_batch(r,j,u,a,e,items_);
 if result_->>'historicalReplay'<>'true' then raise exception 'replay missing';end if;
 begin perform conveni_transactional_bytes_candidate.commit_batch(r,j,u,a,e,jsonb_set(items_,'{1,base64}',to_jsonb('d3Jvbmc='::text)));raise exception 'changed replay accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_HASH' then raise;end if;end;
 begin perform conveni_transactional_bytes_candidate.commit_batch(r,j,u,a,'00000000-0000-4000-8000-000000000199',items_);raise exception 'second event accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_ATTEMPT_REUSED' then raise;end if;end;
 begin update conveni_preparation_guard_candidate.attempts set state='complete' where id=a;raise exception 'legacy completion accepted';
 exception when raise_exception then if sqlerrm<>'CONVENI_BYTES_DECISION_NOT_INTEGRATED' then raise;end if;end;
 if exists(select 1 from public.service_provisions where source_record_id=r) or exists(select 1 from public.conveni_review_events where source_record_id=r) then raise exception 'unexpected review or financing';end if;
 -- The historical 720 guard already sees the preparation operation. This
 -- proves mixed-delete rollback with a 750 plan, not that the new 750 clause
 -- alone caused the rejection.
 perform public.persist_analysis(j,(select id from public.catalog_versions where active and validated limit 1),'{"classification":"discarded","reasons":["individual_grant"],"explanation":"Descarte ficticio","service_description":"Fixture","target_population":"Fixture"}','[]','[{"content":"fixture"}]');
 select jsonb_build_object('id',id,'job_id',job_id,'result_token',result_token) into protected_ from public.current_record_results where id=r and destination='discarded';
 if protected_ is null then raise exception 'FIXTURE_PROTECTED_DISCARD_MISSING';end if;
 select count(*) into purges_ from public.storage_purge_batches;
 begin perform public.delete_discarded_records(jsonb_build_array(protected_,clean_),2);raise exception 'mixed deletion accepted';
 exception when raise_exception then if sqlerrm<>'PRESERVED_HISTORY_EXISTS' then raise;end if;end;
 if not exists(select 1 from public.source_records where id=r) or not exists(select 1 from public.source_records where id=(clean_->>'id')::uuid)
 or not exists(select 1 from conveni_transactional_bytes_candidate.plans where attempt_id=a)
 or (select count(*) from conveni_transactional_bytes_candidate.items where event_id=e)<>2
 or (select count(*) from public.storage_purge_batches)<>purges_ then raise exception 'mixed delete rollback incomplete';end if;
 raise notice 'capture + replay; wrong scope; rollback + wrong hash + duplicate; atomic batch + replay; legacy completion blocked; mixed delete rolled back; no financing';
end $$;
