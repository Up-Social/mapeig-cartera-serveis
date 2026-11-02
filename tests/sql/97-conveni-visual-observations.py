"""Candidate chain and synthetic visual statements in a disposable networkless DB."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
harness=root/'tests/sql/94-conveni-retained-real-schema.py'
source=harness.read_text()
anchor=" sql('''do $$ declare sid uuid:="
assert source.count(anchor)==1
extra=r'''
 sql("""do $$ declare s uuid:='53000001-0000-4000-8000-000000000001';d uuid:='53000001-0000-4000-8000-000000000002';o uuid:='53000001-0000-4000-8000-000000000003';read_ uuid:='53000001-0000-4000-8000-000000000004';event_ uuid:='53000001-0000-4000-8000-000000000005';other uuid:='53000001-0000-4000-8000-000000000006';h text:=repeat('a',64);path_ text;snapshot jsonb;begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload) values(s,'convenis',s::text,'Conveni','Sintètic','{}');
 path_:='cases/'||s||'/documents/'||d||'/'||h||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,mime_type,storage_path,storage_sha256) values(d,s,'https://example.invalid/doc',d::text,'agreement','fetched','application/pdf',path_,h);
 insert into storage.objects(id,bucket_id,name,version) values(o,'cloud-documents',path_,'53000001-0000-4000-8000-000000000007');
 snapshot:=conveni_visual_source(s,d);
 perform conveni_visual_save_read(read_,s,d,snapshot);perform conveni_visual_save_read(read_,s,d,snapshot);
 begin perform conveni_visual_assert(event_,read_,s,d,1,'economic','Cita sintètica llarga','Nom declarat','Justificació sintètica',false);raise exception 'missing confirmation accepted';exception when raise_exception then if sqlerrm<>'VISUAL_CONFIRMATION_REQUIRED' then raise;end if;end;
 perform conveni_visual_assert(event_,read_,s,d,1,'economic','Cita sintètica llarga','Nom declarat','Justificació sintètica',true);
 perform conveni_visual_assert(event_,read_,s,d,1,'economic','Cita sintètica llarga','Nom declarat','Justificació sintètica',true);
 if jsonb_array_length(conveni_visual_history(s))<>1 or conveni_visual_history(s)->0->>'source_sha256'<>h then raise exception 'history missing';end if;
 begin perform conveni_visual_assert(event_,read_,s,d,2,'economic','Cita sintètica llarga','Nom declarat','Justificació sintètica',true);raise exception 'modified replay accepted';exception when raise_exception then if sqlerrm<>'VISUAL_EVENT_REUSED' then raise;end if;end;
 begin update conveni_visual_observations set page=2 where event_id=event_;raise exception 'history update accepted';exception when raise_exception then if sqlerrm<>'VISUAL_HISTORY_IMMUTABLE' then raise;end if;end;
 update storage.objects set version='53000001-0000-4000-8000-000000000008' where id=o;
 begin perform conveni_visual_assert(other,read_,s,d,1,'economic','Cita sintètica llarga','Nom declarat','Justificació sintètica',true);raise exception 'stale source accepted';exception when sqlstate 'PT409' then if sqlerrm<>'VISUAL_SOURCE_STALE' then raise;end if;end;
 if has_table_privilege('service_role','public.conveni_visual_reads','insert') or has_table_privilege('authenticated','public.conveni_visual_observations','select') or has_function_privilege('anon','public.conveni_visual_source(uuid,uuid)','execute') or not has_function_privilege('service_role','public.conveni_visual_source(uuid,uuid)','execute') then raise exception 'VISUAL_ACL';end if;
 if exists(select 1 from service_provisions where source_record_id=s) or exists(select 1 from conveni_review_events where source_record_id=s) then raise exception 'unexpected approval';end if;
 delete from source_records where id=s;
 if exists(select 1 from conveni_visual_reads where event_id=read_) or exists(select 1 from conveni_visual_observations where event_id=event_) then raise exception 'delete cascade failed';end if;
 end $$;""")
 print('PASS: 530 scope, confirmations, exact replay, stale version, ACL, immutability and delete cascade; no approval')
'''
source=source.replace(anchor,extra+anchor)
exec(compile(source,str(harness),'exec'),{'__file__':str(harness),'__name__':'__main__'})
