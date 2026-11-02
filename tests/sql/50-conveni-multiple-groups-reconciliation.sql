do $$
declare sid uuid:=gen_random_uuid();run uuid;j uuid;doc uuid:=gen_random_uuid();u uuid;v text;code text;sha text:=repeat('9',64);path text;revision text;source_hash text;
 actors jsonb:='[]';units jsonb:='[]';bundle jsonb;group_ jsonb;child jsonb;c jsonb;total_citation jsonb;identity_citation jsonb;heads jsonb;receipts jsonb;result_ jsonb;
 confirmations jsonb:='{"public_total":true,"recipient_period":true,"covers_concepts":true,"same_social_service":true,"recipient_role":true,"conditions_preserved":true,"not_a_sum_or_shared":true}';
 name_ text;nif_ text;quote_ text;total_quote text;identity_quote text;text_ text:='';idx integer;k integer;event_ uuid;head_hash text;group_hash text;analysis_hash text;first_unit uuid;first_head uuid;first_hash text;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(sid,'convenis',sid::text,'Conveni','Dos grups','{"Total aportacions previstes Generalitat":20000,"Total aportacions previstes ens locals":0}');
 source_hash:=conveni_source_hash(sid);select id into strict v from catalog_versions where active and validated;select service_code into code from eligible_official_services where version_id=v limit 1;
 for idx in 1..2 loop
  name_:='Fundació '||chr(64+idx);nif_:=case idx when 1 then 'G12345678' else 'G87654321' end;
  quote_:='El servei social de '||name_||' atén persones grans durant l’any 2025.';
  total_quote:='L’aportació pública total a '||name_||' durant l’any 2025 és de 10.000,00 € segons el conveni.';
  identity_quote:=name_||' amb NIF '||nif_||' consta com a entitat receptora.';
  text_:=text_||quote_||chr(10)||total_quote||chr(10)||identity_quote||chr(10);
  c:=jsonb_build_object('document_id',doc,'page',1,'quote',quote_);
  identity_citation:=jsonb_build_object('document_id',doc,'page',1,'quote',identity_quote);
  child:=jsonb_build_object('recipient',name_,'recipient_nif',nif_,'recipient_nature','private','period','2025','year',2025,'amount_state','planned','amount_cents',600000,'joint',false,'mixed',false,'blockers','[]'::jsonb,'evidence',jsonb_build_array(c));
  group_:=jsonb_build_object('key','fundacio '||lower(chr(64+idx))||'|2025','recipient',name_,'recipient_nif',nif_,'recipient_nature','private','period','2025','year',2025,'amount_cents',null,'amount_state','planned','joint',false,'mixed',true,'financiers',jsonb_build_array('Ajuntament'),'classification','insufficient_evidence','population','Gent gran','description','Servei','explanation','Conceptes pendents','blockers',jsonb_build_array('mixed','missing_amount','reconciliation'),'evidence',jsonb_build_array(c),'concepts',jsonb_build_array(child,child));
  units:=units||jsonb_build_array(group_);
  actors:=actors||jsonb_build_array(jsonb_build_object('name',name_,'nif',nif_,'nature','private','roles',jsonb_build_array('recipient'),'evidence',jsonb_build_array(identity_citation)));
 end loop;
 path:='cases/'||sid||'/documents/'||doc||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,extracted_text,storage_path,storage_sha256,text_length,extraction_partial)
 values(doc,sid,'https://example.invalid/'||doc,doc::text,'agreement','fetched','application/pdf','## Pàgina 1'||chr(10)||text_,path,sha,1000,false);
 insert into storage.objects(bucket_id,name,version) values('cloud-documents',path,gen_random_uuid()::text);
 select storage_sha256||':'||coalesce(active_extraction_id::text,'') into revision from source_documents where id=doc;
 bundle:=jsonb_build_object('actors',actors,'units',units,'instrument_grant',false,'coverage_complete',true,'unallocated_cents',0,'summary','Dos grups pendents');
 insert into pipeline_runs default values returning id into run;insert into pipeline_jobs(run_id,source_record_id,status) values(run,sid,'ready') returning id into j;
 perform persist_conveni(j,v,bundle,jsonb_build_object(doc::text,revision),source_hash);
 receipts:=conveni_archive_snapshot(sid,array[doc]);
 for idx in 1..2 loop
  name_:='Fundació '||chr(64+idx);nif_:=case idx when 1 then 'G12345678' else 'G87654321' end;
  quote_:='El servei social de '||name_||' atén persones grans durant l’any 2025.';
  total_quote:='L’aportació pública total a '||name_||' durant l’any 2025 és de 10.000,00 € segons el conveni.';
  identity_quote:=name_||' amb NIF '||nif_||' consta com a entitat receptora.';
  c:=jsonb_build_object('document_id',doc,'page',1,'quote',quote_);total_citation:=jsonb_build_object('document_id',doc,'page',1,'quote',total_quote);identity_citation:=jsonb_build_object('document_id',doc,'page',1,'quote',identity_quote);
  select unit_id into strict u from conveni_unit_proposals where job_id=j and data->>'recipient'=name_;
  heads:='{}';
  for k in 0..1 loop
   event_:=gen_random_uuid();select cp.concept_hash into strict head_hash from conveni_concept_proposals cp where cp.job_id=j and cp.unit_id=u and cp.concept_index=k;
   perform review_conveni_concept(sid,j,u,k,event_,null,null,head_hash,source_hash,jsonb_build_object(doc::text,revision),'select',code,'Concepte revisat amb document',c,true);
   heads:=heads||jsonb_build_object(k::text,event_);
   if idx=1 and k=0 then first_unit:=u;first_head:=event_;first_hash:=head_hash;end if;
  end loop;
  select gp.group_hash,gp.analysis_hash into strict group_hash,analysis_hash from conveni_group_preparations gp where gp.job_id=j and gp.unit_id=u;
  perform prepare_conveni_group_verified(sid,j,u,gen_random_uuid(),null,null,group_hash,analysis_hash,source_hash,jsonb_build_object(doc::text,revision),heads,code,1000000,'10.000,00 €',total_citation,identity_citation,confirmations,'Preparació documental del grup',receipts);
  result_:=conveni_strict_reconciliation(sid,j);
  if idx=1 and result_->>'reason'<>'GROUP_PREPARATION_STALE_OR_MISSING' then raise exception 'TEST: group without preparation not blocking: %',result_;end if;
 end loop;
 result_:=conveni_strict_reconciliation(sid,j);
 if result_->>'status'<>'balanced' or (result_->>'allocated_cents')::numeric<>2000000 or jsonb_array_length(result_->'units')<>2 then raise exception 'TEST: two explicit totals not counted exactly once: %',result_;end if;
 -- Four concept amounts are 24,000 euros; the diagnostic never sums them.
 perform review_conveni_concept(sid,j,first_unit,0,gen_random_uuid(),first_head,null,first_hash,source_hash,jsonb_build_object(doc::text,revision),'insufficient',null,'Concepte posterior pendent',jsonb_build_object('document_id',doc,'page',1,'quote','El servei social de Fundació A atén persones grans durant l’any 2025.'),false);
 if conveni_strict_reconciliation(sid,j)->>'reason'<>'GROUP_PREPARATION_STALE_OR_MISSING' then raise exception 'TEST: changed head did not block group';end if;
 if exists(select 1 from service_provisions where source_record_id=sid) then raise exception 'TEST: arithmetic diagnosis published a provision';end if;
end $$;
