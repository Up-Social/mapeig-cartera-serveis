-- Synthetic local-only fixture; the test runner owns its transaction.
do $$
declare sid uuid:=gen_random_uuid();rid uuid;j uuid;c jsonb; a text:='prepared-json-v1:'||repeat('a',64);b text:='prepared-json-v1:'||repeat('b',64);other text:='prepared-json-v1:'||repeat('c',64); before_rows jsonb;
begin
 update app_settings set enabled=true where key='processing_enabled';
 insert into source_records(id,source_dataset,source_record_id,mechanism,title) values(sid,'convenis',sid::text,'Conveni','Synthetic');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'ready') returning id into j;
 -- Fresh first request then normal replay; saving an in-flight response is unchanged.
 c:=claim_provider_call(j,'matching',a);if (c->>'send')::boolean is not true then raise exception 'Fresh claim failed';end if;
 update provider_calls set state='received',response='{"id":"first"}' where id=(c->>'id')::uuid;
 c:=claim_provider_call(j,'matching',a);if (c->>'send')::boolean is not false or c->'response'->>'id'<>'first' then raise exception 'Exact replay failed';end if;
 begin perform claim_provider_call(j,'matching',b);raise exception 'TEST: changed request accepted';exception when raise_exception then if sqlerrm<>'PROVIDER_REQUEST_CHANGED' then raise;end if;end;
 -- A legacy different hash or a second versioned hash both prevent exact replay.
 insert into provider_calls(pipeline_job_id,phase,request_hash,state,response) values(j,'matching','legacy-unversioned','received','{"id":"legacy"}');
 select jsonb_agg(to_jsonb(pc) order by pc.id) into before_rows from provider_calls pc where pipeline_job_id=j;
 begin perform claim_provider_call(j,'matching',a);raise exception 'TEST: conflicting receipt ignored';exception when raise_exception then if sqlerrm<>'PROVIDER_REQUEST_CHANGED' then raise;end if;end;
 if before_rows is distinct from (select jsonb_agg(to_jsonb(pc) order by pc.id) from provider_calls pc where pipeline_job_id=j) then raise exception 'Conflict mutated journal';end if;
 delete from provider_calls where pipeline_job_id=j and request_hash='legacy-unversioned';
 insert into provider_calls(pipeline_job_id,phase,request_hash,state,response) values(j,'matching',b,'received','{"id":"other"}');
 begin perform claim_provider_call(j,'matching',a);raise exception 'TEST: conflicting versioned receipt ignored';exception when raise_exception then if sqlerrm<>'PROVIDER_REQUEST_CHANGED' then raise;end if;end;
 -- Uncertainty in ANY phase wins even over an exact response or conflicting hash.
 insert into provider_calls(pipeline_job_id,phase,request_hash,state) values(j,'enrichment',other,'sending');
 begin perform claim_provider_call(j,'matching',a);raise exception 'TEST: sending not prioritised';exception when raise_exception then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 begin perform claim_provider_call(j,'matching',null);raise exception 'TEST: sending not prioritised over malformed hash';exception when raise_exception then if sqlerrm<>'PROVIDER_UNKNOWN' then raise;end if;end;
 update provider_calls set state='received',response='{}' where pipeline_job_id=j and phase='enrichment';
 begin perform claim_provider_call(j,'matching',null);raise exception 'TEST: malformed hash accepted';exception when raise_exception then if sqlerrm<>'PROVIDER_REQUEST_INVALID' then raise;end if;end;
 if not has_function_privilege('service_role','public.claim_provider_call(uuid,text,text)','execute') or has_function_privilege('anon','public.claim_provider_call(uuid,text,text)','execute') or has_function_privilege('authenticated','public.claim_provider_call(uuid,text,text)','execute') then raise exception 'Journal RPC permissions changed';end if;
 -- No same-phase conflict applies to another phase; paused INSERT remains fenced.
 if (claim_provider_call(j,'enrichment',other)->>'send')::boolean is not false then raise exception 'Different phase replay changed';end if;
 update app_settings set enabled=false where key='processing_enabled';
 -- Existing SQL replay is read-only even when paused; the application wrapper
 -- separately checks processing before calling the RPC. No new send is allowed.
 if (claim_provider_call(j,'enrichment',other)->>'send')::boolean is not false then raise exception 'Paused exact replay changed';end if;
 begin perform claim_provider_call(j,'new-phase',a);raise exception 'TEST: paused send accepted';exception when sqlstate '55000' then if sqlerrm<>'PROCESSING_DISABLED' then raise;end if;end;
 update app_settings set enabled=true where key='processing_enabled';
end $$;
