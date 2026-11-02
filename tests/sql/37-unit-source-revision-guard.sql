do $$
declare sid uuid:=gen_random_uuid();d uuid:=gen_random_uuid();u uuid;sha text:=repeat('a',64);source_path text;unit_path text;url text:='https://example.invalid/source';dnull uuid:=gen_random_uuid();unull uuid;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,financing_type) values(sid,'concerts',sid::text,'Concert','Prova','concert');
 source_path:='cases/'||sid||'/documents/'||d||'/'||sha||'.pdf';
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status,storage_path,storage_sha256,content_hash)
 values(d,sid,url,d::text,'publication','fetched',source_path,sha,sha);
 insert into record_units(source_record_id,unit_key,document_id) values(sid,'source-guard',d) returning id into u;
 insert into source_documents(id,source_record_id,url,url_hash,document_type,status) values(dnull,sid,url,dnull::text,'publication','discovered');
 insert into record_units(source_record_id,unit_key,document_id) values(sid,'null-guard',dnull) returning id into unull;
 begin
  perform publish_unit_source(sid,unull,dnull,url,null,null,null,null,null,null,null);
  raise exception 'TEST: null archive accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 if (select storage_path from record_units where id=unull) is not null then raise exception 'Null archive changed unit';end if;
 unit_path:='cases/'||sid||'/items/'||u||'/documents/'||d||'/'||sha||'.pdf';
 begin
  perform publish_unit_source(sid,u,d,url,source_path,sha,repeat('b',64),null,null,unit_path,sha);
  raise exception 'TEST: changed source accepted';
 exception when sqlstate '40001' then null;end;
 if (select storage_path from record_units where id=u) is not null then raise exception 'Stale copy published';end if;
 if publish_unit_source(sid,u,d,url,source_path,sha,sha,null,null,unit_path,sha)<>u then raise exception 'Valid publication failed';end if;
 if publish_unit_source(sid,u,d,url,source_path,sha,sha,unit_path,sha,unit_path,sha)<>u then raise exception 'Retry failed';end if;
 begin
  perform publish_unit_source(sid,u,d,url,source_path,sha,sha,null,null,unit_path,sha);
  raise exception 'TEST: changed unit pointer accepted';
 exception when sqlstate '40001' then null;end;
 begin
  perform publish_unit_source(sid,u,d,url,source_path,sha,sha,unit_path,sha,unit_path||'-bad',sha);
  raise exception 'TEST: invalid item path accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
end $$;
