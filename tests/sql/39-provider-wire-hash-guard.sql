do $$
declare sid uuid:=gen_random_uuid();rid uuid;j uuid;call jsonb;bad text;before_count int;
 good text:='prepared-json-v1:'||repeat('a',64);changed text:='prepared-json-v1:'||repeat('b',64);
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'convenis',sid::text,'Conveni','Conveni sintètic');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'ready') returning id into j;
 insert into provider_calls(pipeline_job_id,phase,request_hash,state,response) values(j,'other-phase','legacy-unversioned','received','{}');
 foreach bad in array array[null,'','legacy-unversioned',repeat('a',64),'prepared-json-v1:'||repeat('a',63),'prepared-json-v1:'||repeat('g',64),'prepared-json-v1:'||repeat('A',64)] loop
  select count(*) into before_count from provider_calls where pipeline_job_id=j;
  begin perform claim_provider_call(j,'other-phase',bad);raise exception 'TEST: malformed hash accepted';
  exception when raise_exception then if sqlerrm<>'PROVIDER_REQUEST_INVALID' then raise;end if;end;
  if (select count(*) from provider_calls where pipeline_job_id=j)<>before_count then raise exception 'Malformed hash changed journal';end if;
 end loop;
 begin perform claim_provider_call(j,'other-phase',good);raise exception 'TEST: legacy receipt bypassed';
 exception when raise_exception then if sqlerrm<>'PROVIDER_REQUEST_CHANGED' then raise;end if;end;
 call:=claim_provider_call(j,'next-phase',good);
 update provider_calls set state='received',response='{"id":"saved"}'::jsonb where id=(call->>'id')::uuid;
 if (claim_provider_call(j,'next-phase',good)->>'send')::boolean then raise exception 'Versioned receipt not reused';end if;
 begin perform claim_provider_call(j,'next-phase',changed);raise exception 'TEST: changed wire request accepted';
 exception when raise_exception then if sqlerrm<>'PROVIDER_REQUEST_CHANGED' then raise;end if;end;
 call:=claim_provider_call(j,'third-phase',good);
 foreach bad in array array[null,'legacy-unversioned',changed] loop
  begin perform claim_provider_call(j,'other-phase',bad);raise exception 'TEST: uncertain call bypassed';
  exception when raise_exception then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 end loop;
end $$;
