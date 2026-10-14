-- Disposable fixtures in the isolated test transaction only. No real approvals.
create function pg_temp.economic_fixture(p_name text,p_act text) returns uuid language plpgsql as $$
declare sid uuid:=gen_random_uuid();rid uuid;jid uuid;did uuid;uid uuid:=gen_random_uuid();digest text:=md5(p_name)||md5(p_name);quote text:='El document acredita el període 2024 i l’import assignat a l’entitat de prova.';path text;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values(sid,'concerts',sid::text,'Concert',p_name,'concert');
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'approved') returning id into jid;
 path:='cases/'||sid||'/documents/'||gen_random_uuid()||'/'||digest||'.pdf';
 insert into source_documents(source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,text_length,storage_path,storage_sha256,extraction_version)
 values(sid,'https://example.invalid/'||sid,md5(sid::text),'annex','fetched','application/pdf',quote,length(quote),path,digest,'readable-markdown-v3') returning id into did;
 insert into storage.objects(bucket_id,name) values('cloud-documents',path);
 path:='cases/'||sid||'/items/'||uid||'/documents/'||did||'/'||digest||'.pdf';
 insert into storage.objects(bucket_id,name) values('cloud-documents',path);
 insert into record_units(id,source_record_id,pipeline_job_id,unit_key,provider_name,provider_nif,reses_code,territory,period,act_type,amount,document_id,page,evidence_quote,status,storage_path,storage_sha256,horizon_state)
 values(uid,sid,jid,'test-line','Entitat de prova','G12345678','S01150','Barcelona','2024',p_act,100,did,1,quote,'approved',path,digest,'in_scope');
 return uid;
end $$;
do $$ declare a uuid;b uuid;c uuid;l uuid;l2 uuid;fp text;fa text;fb text;j uuid;v jsonb;n integer;begin
 a:=pg_temp.economic_fixture('Original','award');b:=pg_temp.economic_fixture('Ampliació','modification');c:=pg_temp.economic_fixture('Minoració','termination');
 select source_fingerprint,pipeline_job_id,evidence_quote into fa,j,fp from concert_economic_source where id=a;
 select source_fingerprint into fb from concert_economic_source where id=b;
 v:=jsonb_build_object('status','approved','operation','award','amount_cents',10000,'amount_kind','exact','period_start','2024-01-01','period_end','2024-12-31','effective_at','2024-01-01','funder','Drets Socials','evidence_quote',fp,'review_note','Font contrastada en prova aïllada');
 n:=review_concert_economics(a,0,fa,j,v);if n<>1 then raise exception 'Wrong version';end if;
 if (select count(*) from concert_review_audit where subject_id=a)<>1 then raise exception 'Missing audit';end if;
 begin perform review_concert_economics(a,0,fa,j,v);raise exception 'Stale version accepted';exception when others then if sqlerrm='Stale version accepted' then raise;end if;end;
 if (select count(*) from concert_economic_reviews where unit_id=a)<>1 then raise exception 'Repeated review duplicated';end if;
 begin perform review_concert_economics(a,1,'stale-source',j,v);raise exception 'Stale source accepted';exception when others then if sqlerrm='Stale source accepted' then raise;end if;end;
 begin perform review_concert_economics(a,1,fa,j,v||'{"period_start":"2023-01-01"}');raise exception 'Pre-2024 accepted';exception when others then if sqlerrm='Pre-2024 accepted' then raise;end if;end;
 insert into concert_unit_links(later_unit_id,earlier_unit_id,root_unit_id,relation_kind,matching_method,evidence) values(b,a,a,'modification','reses_nif','RESES i NIF contrastats en prova') returning id into l;
 n:=review_concert_link(l,1,fb,fa,'confirmed','Original contrastat en prova aïllada');
 if n<>2 or (select root_unit_id from concert_unit_links where id=l)<>a then raise exception 'Root not resolved';end if;
 insert into concert_unit_links(later_unit_id,earlier_unit_id,root_unit_id,relation_kind,matching_method,evidence) values(c,b,b,'termination','reses_nif','RESES i NIF contrastats en prova') returning id into l2;
 perform review_concert_link(l2,1,(select source_fingerprint from concert_economic_source where id=c),fb,'confirmed','Acte intermedi contrastat en prova');
 if (select root_unit_id from concert_unit_links where id=l2)<>a then raise exception 'Intermediate treated as root';end if;
 begin perform review_concert_link(l,2,fb,fa,'rejected','Retirada amb descendents confirmats');raise exception 'Dangling descendants accepted';exception when others then if sqlerrm='Dangling descendants accepted' then raise;end if;end;
 begin perform review_concert_link(l,1,fb,fa,'rejected','Revisió obsoleta que ha de fallar');raise exception 'Stale link accepted';exception when others then if sqlerrm='Stale link accepted' then raise;end if;end;
 begin insert into concert_unit_links(later_unit_id,earlier_unit_id,root_unit_id,relation_kind,matching_method,evidence,status,review_note,reviewed_at)
 values(b,c,a,'modification','reses_nif','Intent de cicle','confirmed','Intent de cicle en prova',now());raise exception 'Cycle accepted';exception when others then if sqlerrm='Cycle accepted' then raise;end if;end;
 begin perform review_concert_economics(b,0,fb,(select pipeline_job_id from record_units where id=b),v||'{"operation":"award"}');raise exception 'Duplicate award accepted';exception when others then if sqlerrm='Duplicate award accepted' then raise;end if;end;
 if has_function_privilege('anon','public.review_concert_economics(uuid,integer,text,uuid,jsonb)','execute') or has_function_privilege('authenticated','public.review_concert_link(uuid,integer,text,text,text,text)','execute') then raise exception 'Public RPC privileges';end if;
end $$;
do $$ declare uid uuid;u record_units;t uuid;owner_id uuid:=gen_random_uuid();q text:='Fundació fictícia G12345678 1.2.6.2.4.1 S01150 758,81 € -1 -5.311,67 €';line jsonb;first_id uuid;second_id uuid;begin
 uid:=pg_temp.economic_fixture('Annex de minoració','modification');select * into u from record_units where id=uid;
 update source_documents set extracted_text=extracted_text||E'\n'||q where id=u.document_id;
 insert into worker_tasks(source_record_id,task_type,executor,execution_state,lease_owner,lease_generation,lease_until)
 values(u.source_record_id,'enrich_record','vercel_workflow','running',owner_id,1,now()+interval '5 minutes') returning id into t;
 line:=jsonb_build_object('row',1,'page',1,'nif','G12345678','resesCode','S01150','observedServiceCode','1.2.6.2.4.1','amountCents',-531167,'quantityDelta',-1,'actType','modification','quote',q);
 first_id:=cloud_stage_concert_change_line(t,owner_id,1,u.pipeline_job_id,u.document_id,line);
 second_id:=cloud_stage_concert_change_line(t,owner_id,1,u.pipeline_job_id,u.document_id,line);
 if first_id<>second_id then raise exception 'Signed line duplicated';end if;
 if not exists(select 1 from record_units where id=first_id and amount=-5311.67 and quantity_delta=-1 and quantity is null and period is null and status='draft') then raise exception 'Signed observation changed meaning';end if;
 begin perform cloud_stage_concert_change_line(t,owner_id,1,u.pipeline_job_id,u.document_id,line||'{"amountCents":-400000}');raise exception 'Source drift accepted';exception when others then if sqlerrm='Source drift accepted' then raise;end if;end;
end $$;
