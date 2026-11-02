begin;
create temporary table projection_output(rows jsonb);
do $$
declare r uuid:='__RECORD__';j uuid:='__JOB__';u1 uuid:='__UNIT__';d uuid:='__DOC__';u2 uuid;event1 uuid:=gen_random_uuid();event2 uuid:=gen_random_uuid();decision1 uuid:=gen_random_uuid();decision2 uuid:=gen_random_uuid();e uuid;s jsonb;v text;code text;legacy uuid;pid uuid;run2 uuid;q1 text;q2 text;source_path text;item_path text;source_object uuid;item1 uuid;item2 uuid;
 approved jsonb;master jsonb;batch jsonb;evolution jsonb;
begin
 select service_code,version_id into strict code,v from public.eligible_official_services limit 1;
 q1:='Entitat A, servei '||code||' per a persones grans: import 12.000,00 €.';
 q2:='Entitat B, servei '||code||' de suport: import 13.000,00 €.';
 source_path:='cases/'||r||'/documents/'||d||'/'||repeat('a',64)||'.pdf';
 item_path:='cases/'||r||'/items/'||u1||'/documents/'||d||'/'||repeat('a',64)||'.pdf';
 insert into storage.objects(bucket_id,name,version) values('cloud-documents',source_path,'v1') returning id into source_object;
 insert into storage.objects(bucket_id,name,version) values('cloud-documents',item_path,'v1') returning id into item1;
 update public.source_documents set extracted_text=E'## Pàgina 1\n'||q1||E'\n'||q2,storage_path=source_path where id=d;
 update public.record_units set observed_service_code=code,observed_provider_name='Entitat A',evidence_quote=q1,storage_path=item_path,storage_sha256=repeat('a',64) where id=u1;
 select id into strict e from public.concert_population_events where unit_id=u1 and job_id=j order by sequence desc limit 1;
 s:=public.concert_population_snapshot(r,j,u1);
 perform public.concert_population_decide(r,j,u1,event1,e,'confirmed','persones grans',d,s->>'revision',1,q1,'Població contrastada','Revisor',s->>'document_hash',s->>'unit_hash');
 if public.concert_line_award_decide(r,j,u1,decision1,event1,code,'12.000,00',q1,'Adjudicació i import contrastats','Revisor','{"award":true,"recipient":true,"allocation":true}',source_object,'v1',item1,'v1')<>decision1 then raise exception 'LINE_NOT_RECORDED';end if;
 if public.concert_line_award_decide(r,j,u1,decision1,event1,code,'12.000,00',q1,'Adjudicació i import contrastats','Revisor','{"award":true,"recipient":true,"allocation":true}',source_object,'v1',item1,'v1')<>decision1 then raise exception 'LINE_REPLAY_CHANGED';end if;
 begin perform public.concert_line_award_decide(r,j,u1,decision1,event1,code,'12.000,00',q1,'Nota modificada deliberadament','Revisor','{"award":true,"recipient":true,"allocation":true}',source_object,'v1',item1,'v1');raise exception 'TEST_CHANGED_REPLAY';
 exception when raise_exception then if sqlerrm<>'LINE_REPLAY_CONFLICT' then raise;end if;end;
 begin perform public.concert_line_award_decide(r,j,u1,gen_random_uuid(),event1,code,'13.000,00',q1,'Adjudicació i import contrastats','Revisor','{"award":true,"recipient":true,"allocation":true}',source_object,'v1',item1,'v1');raise exception 'TEST_AMOUNT_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'LINE_EVIDENCE' then raise;end if;end;
 begin perform public.concert_line_award_decide(r,j,u1,gen_random_uuid(),event1,code,'12.000,00',q1,'Adjudicació i import contrastats','Revisor','{"award":true,"recipient":false,"allocation":true}',source_object,'v1',item1,'v1');raise exception 'TEST_CONFIRMATION_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'LINE_INVALID' then raise;end if;end;
 insert into public.record_units(source_record_id,pipeline_job_id,unit_key,act_type,document_id,page,evidence_quote,status,amount,observed_service_code,observed_provider_name)
 values(r,j,'synthetic-line-2','award',d,1,q2,'draft',13000,code,'Entitat B') returning id into u2;
 item_path:='cases/'||r||'/items/'||u2||'/documents/'||d||'/'||repeat('a',64)||'.pdf';
 insert into storage.objects(bucket_id,name,version) values('cloud-documents',item_path,'v1') returning id into item2;
 update public.record_units set storage_path=item_path,storage_sha256=repeat('a',64) where id=u2;

 s:=public.concert_population_snapshot(r,j,u2);
 perform public.concert_population_decide(r,j,u2,event2,null,'unknown',null,d,s->>'revision',null,null,'Població no identificada','Revisor',s->>'document_hash',s->>'unit_hash');
 perform public.concert_line_award_decide(r,j,u2,decision2,event2,code,'13.000,00',q2,'Adjudicació i import contrastats','Revisor','{"award":true,"recipient":true,"allocation":true}',source_object,'v1',item2,'v1');
 select jsonb_agg(to_jsonb(x) order by unit_id) into approved from public.concert_line_financing_projection x where source_record_id=r;
 select jsonb_agg(to_jsonb(x) order by unit_id) into master from public.concert_line_financing_projection x where source_record_id=r;
 select jsonb_agg(to_jsonb(x) order by unit_id) into batch from public.concert_line_financing_projection x where source_record_id=r;
 select jsonb_agg(to_jsonb(x) order by unit_id) into evolution from public.concert_line_financing_projection x where source_record_id=r;
 if approved is distinct from master or approved is distinct from batch or approved is distinct from evolution or jsonb_array_length(approved)<>2 then raise exception 'PROJECTIONS_DIFFER';end if;
 if (select sum(amount) from public.concert_line_financing_projection where source_record_id=r)<>25000 then raise exception 'LINE_TOTAL_WRONG';end if;
 if (select target_population from public.concert_line_financing_projection where unit_id=u1) is distinct from 'persones grans'
  or (select target_population from public.concert_line_financing_projection where unit_id=u2) is not null then raise exception 'POPULATION_WRONG';end if;
 insert into projection_output values(approved);
 end $$;
select rows from projection_output;
commit;
