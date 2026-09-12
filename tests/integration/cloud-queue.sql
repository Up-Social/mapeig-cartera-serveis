\set ON_ERROR_STOP on
begin;
insert into source_records(source_dataset,source_record_id,mechanism,title,suggested_code,suggested_name,suggested_confidence,suggested_evidence,amount) values ('contractacions','CLOUD-TEST','contracte','Fictici','','',0,'',0);
do $$ declare t uuid; a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();g bigint;begin
 if current_database() not like 'cartera_cloud_test_%' then raise exception 'Test database required';end if;
 -- Existing fixture rows aren't needed to test reservation and fencing.
 insert into worker_tasks(task_type,source_record_id,executor) select 'enrich_record',id,'vercel_workflow' from source_records limit 1 returning id into t;
 if t is null then raise exception 'Fixture record required';end if;
 g:=cloud_claim(t,a,'test-v1');
 if g is null then raise exception 'claim failed';end if;
 if cloud_claim(t,b,'test-v1') is not null then raise exception 'double claim';end if;
 perform cloud_checkpoint(t,a,g,'safe','{"complete":true}');
 update worker_tasks set lease_until=now()-interval '1 second' where id=t;
 if cloud_claim(t,b,'test-v1')<>g+1 then raise exception 'generation not advanced';end if;
 begin perform cloud_checkpoint(t,a,g,'unsafe','{}');raise exception 'STALE_WRITE_ACCEPTED';
 exception when others then if sqlerrm<>'CLOUD_LEASE_LOST' then raise;end if;end;
 if not cloud_resource('ai',a) then raise exception 'resource unavailable';end if;
 if cloud_resource('ai',b) then raise exception 'double resource';end if;
 perform cloud_resource('ai',a,true,'quota');
 if cloud_resource('ai',b) then raise exception 'quota ignored';end if;
end $$;
rollback;
