-- Synthetic fixture; only run in the disposable, networkless 105 harness.
do $$
declare
 r uuid:='00000000-0000-4000-8000-000000000201';
 j uuid:='00000000-0000-4000-8000-000000000202';
 u uuid:='00000000-0000-4000-8000-000000000203';
 a uuid:='00000000-0000-4000-8000-000000000204';
 op uuid:='00000000-0000-4000-8000-000000000205';
 d uuid:='00000000-0000-4000-8000-000000000206';
 rr uuid:='00000000-0000-4000-8000-000000000207';
 other_ uuid:='00000000-0000-4000-8000-000000000301';
 otherunit_ uuid:='00000000-0000-4000-8000-000000000302';
 planned_ uuid:='00000000-0000-4000-8000-000000000101';
 plannedjob_ uuid:='00000000-0000-4000-8000-000000000102';
 plannedunit_ uuid:='00000000-0000-4000-8000-000000000303';
 provision_ uuid:='00000000-0000-4000-8000-000000000304';
 v text;code_ text;
begin
 insert into public.source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values
  (r,'convenis',r::text,'Conveni','Conveni fixture','conveni'),
  (other_,'concerts',other_::text,'Concert','Concert fixture','concert');
 insert into public.pipeline_runs(id) values(rr);
 insert into public.pipeline_jobs(id,run_id,source_record_id,status) values(j,rr,r,'ready');
 insert into public.record_units(id,source_record_id,pipeline_job_id,unit_key) values(u,r,j,'legacy'),(otherunit_,other_,null,'legacy'),(plannedunit_,planned_,plannedjob_,'legacy');
 insert into public.source_documents(id,source_record_id,url,url_hash,document_type) values(d,r,'https://fixture.invalid/fence','fence','agreement');
 insert into public.conveni_analyses(job_id,source_record_id,source_hash,payload) values(j,r,'fixture','{}');
 insert into public.conveni_unit_proposals(job_id,unit_id,data) values(j,u,'{}');
 -- Synthetic setup only: satisfy the already-enabled 730 stage trigger.
 insert into conveni_preparation_guard_candidate.permits values(pg_backend_pid(),txid_current(),u);
 insert into public.conveni_first_preparation_operations(id,record_id,job_id,unit_id,payload,ids) values(op,r,j,u,'{}','{}');
 delete from conveni_preparation_guard_candidate.permits where pid=pg_backend_pid() and tx=txid_current() and unit_id=u;
 insert into conveni_preparation_guard_candidate.attempts(id,record_id,job_id,unit_id,mode,first_operation_id,state) values(a,r,j,u,'first',op,'active');
 select version_id,service_code into strict v,code_ from public.eligible_official_services order by version_id,service_code limit 1;
 insert into public.service_provisions(id,source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,unit_id,amount)
  values(provision_,other_,'synthetic','Concert','synthetic',code_,v,otherunit_,1);
 -- Both directions of a row move must inspect OLD and NEW under the same locks.
 begin
  update public.service_provisions set source_record_id=planned_,unit_id=plannedunit_ where id=provision_;
  raise exception 'FENCE_MOVED_TO_PLAN';
 exception when serialization_failure then if sqlerrm<>'CONVENI_BYTES_LEGACY_WRITER_BLOCKED' then raise;end if;end;
 begin
  alter table public.service_provisions disable trigger zzzz_conveni_bytea_provision_fence;
  insert into public.service_provisions(source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id,unit_id,amount)
   values(planned_,'synthetic','Conveni','synthetic',code_,v,plannedunit_,1);
  alter table public.service_provisions enable trigger zzzz_conveni_bytea_provision_fence;
  update public.service_provisions set source_record_id=other_,unit_id=otherunit_ where source_record_id=planned_;
  raise exception 'FENCE_MOVED_FROM_PLAN';
 exception when serialization_failure then if sqlerrm<>'CONVENI_BYTES_LEGACY_WRITER_BLOCKED' then raise;end if;end;
 if not exists(select 1 from pg_trigger where tgrelid='public.service_provisions'::regclass and tgname='zzzz_conveni_bytea_provision_fence' and tgenabled='O') then raise exception 'FENCE_TRIGGER_NOT_RESTORED';end if;
 begin
  insert into public.conveni_review_events(id,source_record_id,job_id,unit_id,outcome,reason,actor,snapshot)
  values(gen_random_uuid(),planned_,plannedjob_,'00000000-0000-4000-8000-000000000103','insufficient','synthetic','fixture','{}');
  raise exception 'FENCE_REVIEW_ACCEPTED';
 exception when serialization_failure then if sqlerrm<>'CONVENI_BYTES_LEGACY_WRITER_BLOCKED' then raise;end if;end;
 begin
  insert into conveni_independent_experiment.revisions(id,source_record_id) values(gen_random_uuid(),planned_);
  raise exception 'FENCE_680_REVISION_ACCEPTED';
 exception when serialization_failure then if sqlerrm<>'CONVENI_BYTES_LEGACY_WRITER_BLOCKED' then raise;end if;end;
 begin update public.source_records set financing_type='concert' where id=planned_;raise exception 'FENCE_TYPE_CHANGE_ACCEPTED';
 exception when serialization_failure then if sqlerrm<>'CONVENI_BYTES_TYPE_CHANGE_BLOCKED' then raise;end if;end;
 begin update public.source_records set source_dataset='concerts' where id=planned_;raise exception 'FENCE_DERIVED_TYPE_CHANGE_ACCEPTED';
 exception when serialization_failure then if sqlerrm<>'CONVENI_BYTES_TYPE_CHANGE_BLOCKED' then raise;end if;end;
 -- A normal READ COMMITTED import may correct type when no plan exists.
 update public.source_records set source_dataset='concerts' where id=r;
 if (select financing_type from public.source_records where id=r)<>'concert' then raise exception 'FIXTURE_DERIVED_CONCERT';end if;
 update public.source_records set source_dataset='convenis' where id=r;
 if (select financing_type from public.source_records where id=r)<>'conveni' then raise exception 'FIXTURE_DERIVED_CONVENI';end if;
 raise notice 'PASS old/new economic fence, type fence, 680 fence and ordinary type correction';
end $$;
