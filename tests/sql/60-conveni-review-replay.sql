do $$
declare sid uuid:=gen_random_uuid();rid uuid;j uuid;d uuid;d2 uuid:=gen_random_uuid();u uuid;v text;code text;event uuid:=gen_random_uuid();later uuid:=gen_random_uuid();newjob uuid;newrun uuid;snapshot_ jsonb;later_at timestamptz;foreign_record uuid;foreign_unit uuid;sha text:=repeat('9',64);path text;revision text;hash text;unit jsonb;bundle jsonb;
 q text:='El projecte presta a les persones grans un servei social documentat al municipi de prova, durant l’any 2025.';
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis',sid::text,'Conveni','Conveni sintètic','{"Total aportacions previstes Generalitat":1000,"Total aportacions previstes ens locals":0}');
 hash:=conveni_source_hash(sid);
 insert into pipeline_runs default values returning id into rid;
 insert into pipeline_jobs(run_id,source_record_id,status) values(rid,sid,'ready') returning id into j;
 select id into strict v from catalog_versions where active and validated;
 select service_code into code from eligible_official_services where version_id=v limit 1;
 d:=gen_random_uuid();path:='cases/'||sid||'/documents/'||d||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(d,sid,'https://example.invalid/'||d,d::text,'agreement','fetched','application/pdf',q,path,sha,400,false);
 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into revision from source_documents where id=d;
 unit:=jsonb_build_object('key','entitat|2025','recipient','Entitat de prova','recipient_nif',null,'recipient_nature','unknown','period','2025','year',2025,'amount_cents',100000,'amount_state','planned','joint',false,'mixed',false,'financiers',jsonb_build_array('Ajuntament'),'territory','Vic','classification','insufficient_evidence','service_code',null,'population','Persones grans','description','Servei social','explanation','Proposta insuficient','reason',null,'blockers',jsonb_build_array('unknown_recipient','missing_nif'),'evidence',jsonb_build_array(jsonb_build_object('document_id',d,'page',1,'quote',q)));
 bundle:=jsonb_build_object('actors','[]'::jsonb,'units',jsonb_build_array(unit),'instrument_grant',false,'coverage_complete',true,'unallocated_cents',0,'summary','Revisió pendent');
 perform persist_conveni(j,v,bundle,jsonb_build_object(d::text,revision),hash);
 select unit_id into strict u from conveni_unit_proposals where job_id=j;
 perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);
 perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);
 if (select count(*) from conveni_review_events where unit_id=u)<>1 or (select count(*) from review_decisions where source_record_id=sid)<>1 then raise exception 'TEST: retry duplicated history';end if;
 -- Foreign units are not protected by this record's unit locks and must not
 -- enter either the replay fingerprint or any newly recorded decision.
 begin
  insert into source_records(source_dataset,source_record_id,mechanism,title,source_payload) values('convenis',gen_random_uuid()::text,'Conveni','Foreign fixture','{}') returning id into foreign_record;
  insert into record_units(source_record_id,unit_key) values(foreign_record,'conveni:foreign') returning id into foreign_unit;
  insert into conveni_unit_proposals(job_id,unit_id,data) values(j,foreign_unit,unit);
  begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);raise exception 'TEST: foreign replay accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_REPLAY_STALE' then raise;end if;end;
  begin perform review_conveni_unit(sid,j,u,gen_random_uuid(),event,'outside',null,'Nova revisió documentada',true);raise exception 'TEST: foreign new review accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_UNIT_SCOPE_INVALID' then raise;end if;end;
  raise exception 'ROLLBACK_FOREIGN_FIXTURE';
 exception when raise_exception then if sqlerrm<>'ROLLBACK_FOREIGN_FIXTURE' then raise;end if;end;
 update record_units set review_note='Nota canviada' where id=u;
 begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);raise exception 'TEST: changed review note accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_REPLAY_STALE' then raise;end if;end;
 update record_units set review_note='Revisió documentada de prova' where id=u;
 -- Previous token, content, source, proposal, document, job and historical
 -- unknown fingerprint each fail closed without writing another decision.
 begin perform review_conveni_unit(sid,j,u,event,gen_random_uuid(),'outside',null,'Revisió documentada de prova',true);raise exception 'TEST: different previous accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_REPLAY_STALE' then raise;end if;end;
 begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada alterada',true);raise exception 'TEST: changed note accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_REPLAY_STALE' then raise;end if;end;
 update source_records set title='Conveni modificat' where id=sid;
 begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);raise exception 'TEST: changed source accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_REPLAY_STALE' then raise;end if;end;
 update source_records set title='Conveni sintètic' where id=sid;
 update conveni_unit_proposals set data=jsonb_set(data,'{period}','"2026"') where job_id=j and unit_id=u;
 begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);raise exception 'TEST: changed proposal accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_REPLAY_STALE' then raise;end if;end;
 update conveni_unit_proposals set data=unit where job_id=j and unit_id=u;
 update source_documents set extracted_text=extracted_text||' canvi' where id=d;
 begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);raise exception 'TEST: changed document text accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_REPLAY_STALE' then raise;end if;end;
 update source_documents set extracted_text=q where id=d;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(d2,sid,'https://example.invalid/'||d2,d2::text,'annex','fetched','application/pdf',q,'cases/'||sid||'/documents/'||d2||'/'||sha||'.pdf',sha,400,false);
 begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);raise exception 'TEST: new annex accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_REPLAY_STALE' then raise;end if;end;
 delete from source_documents where id=d2;
 begin
 insert into pipeline_runs default values returning id into newrun;
 insert into pipeline_jobs(run_id,source_record_id,status) values(newrun,sid,'ready') returning id into newjob;
 begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);raise exception 'TEST: newer job accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_REPLAY_STALE' then raise;end if;end;
 raise exception 'ROLLBACK_NEW_JOB_FIXTURE';
 exception when raise_exception then if sqlerrm<>'ROLLBACK_NEW_JOB_FIXTURE' then raise;end if;end;
 select snapshot into snapshot_ from conveni_review_events where id=event;
 update conveni_review_events set snapshot=snapshot-'replay_version'-'replay_context'-'replay_previous'-'replay_decision_id' where id=event;
 begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);raise exception 'TEST: historical ambiguous replay accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_REPLAY_STALE' then raise;end if;end;
 update conveni_review_events set snapshot=snapshot_ where id=event;
 perform review_conveni_unit(sid,j,u,later,event,'outside',null,'Segona revisió documentada',true);
 -- Even a successor with an earlier timestamp invalidates its parent.
 select created_at into later_at from conveni_review_events where id=later;
 update conveni_review_events set created_at=(select created_at-interval '1 second' from conveni_review_events where id=event) where id=later;
 begin perform review_conveni_unit(sid,j,u,event,null,'outside',null,'Revisió documentada de prova',true);raise exception 'TEST: superseded event accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_REVIEW_REPLAY_STALE' then raise;end if;end;
 update conveni_review_events set created_at=later_at where id=later;
 perform review_conveni_unit(sid,j,u,later,event,'outside',null,'Segona revisió documentada',true);
 if (select count(*) from conveni_review_events where unit_id=u)<>2 or (select count(*) from review_decisions where source_record_id=sid)<>2 then raise exception 'TEST: stale retry changed history';end if;
end $$;
