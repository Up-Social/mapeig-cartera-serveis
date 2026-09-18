do $$
declare r uuid; j uuid; j2 uuid; doc uuid; snap uuid; hash text; version_count integer;
begin
 insert into pipeline_runs default values returning id into r;
 insert into pipeline_jobs(run_id,source_record_id) values(r,'aaaaaaaa-0000-4000-8000-000000000001') returning id into j;
 insert into source_documents(source_record_id,url,url_hash,document_type,source_fields) values('aaaaaaaa-0000-4000-8000-000000000001','https://example.invalid/test','fixture','publication','{}') returning id into doc;
 insert into evidence_chunks(source_document_id,ordinal,content,content_hash,character_count) values(doc,1,'First fictitious evidence','first',25);
 snap:=capture_job_snapshot(j,'fixture_first');
 select content_hash into hash from job_snapshots where id=snap;
 update source_documents set text_preview='new preview' where id=doc;
 if (select text_preview from source_documents where id=doc)<>'new preview' then raise exception 'Projection update lost';end if;
 perform replace_document_chunks(doc,'[{"ordinal":1,"content":"Second fictitious evidence","content_hash":"second"}]','{"text_preview":"new preview","quality_score":1,"quality_flags":[]}');
 insert into pipeline_runs default values returning id into r;
 insert into pipeline_jobs(run_id,source_record_id) values(r,'aaaaaaaa-0000-4000-8000-000000000001') returning id into j2;
 perform capture_job_snapshot(j2,'fixture_second');
 if (select content_hash from job_snapshots where id=snap)<>hash then raise exception 'Historical snapshot modified';end if;
 if not exists(select 1 from job_document_versions jv join document_versions v on v.id=jv.document_version_id where jv.snapshot_id=snap and v.payload->'chunks'->0->>'content'='First fictitious evidence') then raise exception 'Historical document lost';end if;
 select count(*) into version_count from document_versions where source_document_id=doc;
 if version_count<2 then raise exception 'Expected distinct document versions, got %',version_count;end if;
 if (select count(*) from job_attempts where pipeline_job_id in(j,j2))<>2 then raise exception 'Missing attempt';end if;
end $$;
