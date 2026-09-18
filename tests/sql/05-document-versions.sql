do $$
declare d uuid; first_chunk uuid;
begin
 insert into source_documents(source_record_id,url,url_hash,document_type) values('aaaaaaaa-0000-4000-8000-000000000001','https://example.invalid/version','version-fixture','annex') returning id into d;
 perform replace_document_chunks(d,'[{"ordinal":0,"content":"First fixture","content_hash":"one"}]','{"quality_flags":[],"quality_score":1}');
 select id into first_chunk from current_evidence_chunks where source_document_id=d;
 perform replace_document_chunks(d,'[{"ordinal":0,"content":"Second fixture","content_hash":"two"}]','{"quality_flags":[],"quality_score":1}');
 if (select count(*) from evidence_chunks where source_document_id=d)<>2 then raise exception 'Old chunk lost';end if;
 if (select content from evidence_chunks where id=first_chunk)<>'First fixture' then raise exception 'Old evidence mutated';end if;
 if (select count(*) from current_evidence_chunks where source_document_id=d)<>1 then raise exception 'Mixed extraction versions';end if;
 if (select content from current_evidence_chunks where source_document_id=d)<>'Second fixture' then raise exception 'Current evidence incorrect';end if;
end $$;
