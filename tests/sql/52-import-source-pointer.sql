do $$
declare sid uuid:=gen_random_uuid();run_ uuid:=gen_random_uuid(); expected jsonb;previous jsonb;archive_ jsonb;sha text:=repeat('a',64);worksha text:=repeat('c',64);path_ text;old_run uuid:=gen_random_uuid();old_path text;legacy_id uuid:=gen_random_uuid();legacy_expected jsonb;legacy_archive jsonb;legacy_path text;
begin
 insert into import_runs(id) values(run_);
 archive_:=jsonb_build_object('path','imports/'||run_||'/'||worksha||'.xlsx','sha256',worksha);
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_file,source_sheet,source_row,source_payload,source_payload_hash,import_run_id)
 values(sid,'contractacions',sid::text,'Contract','Synthetic','Book.xlsx','Sheet',2,'{"title":"original","literal":"à, (x)"}','declared-hash',run_);
 expected:=jsonb_build_object('source_dataset','contractacions','source_record_id',sid::text,'source_file','Book.xlsx','source_sheet','Sheet','source_row',2,'source_payload','{"title":"original","literal":"à, (x)"}'::jsonb,'source_payload_hash','declared-hash','import_run_id',run_);
 previous:=jsonb_build_object('storage_path',null,'storage_sha256',null);
 path_:='cases/'||sid||'/imports/'||run_||'/'||sha||'.json';
 if publish_import_source(null,expected,previous,archive_,path_,sha) is not false or publish_import_source(sid,expected,previous,archive_,null,sha) is not false or publish_import_source(sid,expected,previous,archive_,path_,null) is not false then raise exception 'Null scope accepted';end if;
 if publish_import_source(sid,expected,previous,archive_,path_||'-bad',sha) is not false then raise exception 'Invalid path accepted';end if;
 if publish_import_source(sid,expected,previous,jsonb_build_object('path','imports/'||old_run||'/'||worksha||'.xlsx','sha256',worksha),path_,sha) is not false then raise exception 'Unrelated workbook accepted';end if;
 if publish_import_source(sid,expected,previous,archive_,path_,sha) is not false then raise exception 'Missing manifest accepted';end if;
 if publish_import_workbook(run_,'Book.xlsx',archive_->>'path',worksha,123) is not true then raise exception 'Workbook publication failed';end if;
 if publish_import_workbook(run_,'Book.xlsx',archive_->>'path',worksha,123) is not true then raise exception 'Identical workbook retry rejected';end if;
 if publish_import_workbook(run_,'Book.xlsx','imports/'||run_||'/'||repeat('d',64)||'.xlsx',repeat('d',64),123) is not false then raise exception 'Different workbook replaced manifest';end if;
 begin update import_runs set storage_manifest='{}' where id=run_;raise exception 'TEST: manifest deletion allowed';exception when check_violation then null;end;
 if publish_import_workbook(run_,'Another.xlsx',archive_->>'path',worksha,123) is not true then raise exception 'Independent workbook was not appended';end if;
 begin update import_runs set storage_manifest=storage_manifest-'Another.xlsx' where id=run_;raise exception 'TEST: concurrent append lost';exception when check_violation then null;end;
 update source_records set source_payload='{"title":"changed","literal":"à, (x)"}' where id=sid;
 if publish_import_source(sid,expected,previous,archive_,path_,sha) is not false then raise exception 'Changed payload with same hash accepted';end if;
 update source_records set source_payload=expected->'source_payload' where id=sid;
 update source_records set storage_path='concurrent',storage_sha256=repeat('b',64) where id=sid;
 if publish_import_source(sid,expected,previous,archive_,path_,sha) is not false then raise exception 'Changed pointer overwritten';end if;
 if (select storage_path from source_records where id=sid)<>'concurrent' then raise exception 'Previous pointer not preserved';end if;
 update source_records set storage_path=null,storage_sha256=null where id=sid;
 if publish_import_source(sid,expected,previous,archive_,path_,sha) is not true then raise exception 'Valid source not published';end if;
 if publish_import_source(sid,expected,previous,archive_,path_,sha) is not true then raise exception 'Identical replay not recognized';end if;
 if publish_import_source(sid,expected,jsonb_build_object('storage_path',path_,'storage_sha256',sha),archive_,'cases/'||sid||'/imports/'||run_||'/'||repeat('d',64)||'.json',repeat('d',64)) is not false then raise exception 'Same-run confirmed pointer overwritten';end if;
 old_path:='cases/'||sid||'/imports/'||old_run||'/'||repeat('b',64)||'.json';
 update source_records set storage_path=old_path,storage_sha256=repeat('b',64) where id=sid;
 if publish_import_source(sid,expected,jsonb_build_object('storage_path',old_path,'storage_sha256',repeat('b',64)),archive_,path_,sha) is not true then raise exception 'Legitimate reimport rejected';end if;
 if publish_import_source(sid,jsonb_set(expected,'{source_file}','"Other.xlsx"'),previous,archive_,path_,sha) is not false then raise exception 'Changed source location accepted';end if;
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_file,source_sheet,source_row,source_payload,source_payload_hash)
 values(legacy_id,'concerts',legacy_id::text,'Concert','Synthetic','report.json','Sheet',2,'{"title":"legacy"}','declared');
 legacy_expected:=jsonb_build_object('source_dataset','concerts','source_record_id',legacy_id::text,'source_file','report.json','source_sheet','Sheet','source_row',2,'source_payload','{"title":"legacy"}'::jsonb,'source_payload_hash','declared','import_run_id',null);
 legacy_archive:=jsonb_build_object('path','imports/legacy/'||worksha||'.json','sha256',worksha);
 legacy_path:='cases/'||legacy_id||'/imports/legacy/'||sha||'.json';
 if publish_import_source(legacy_id,legacy_expected,previous,legacy_archive,legacy_path,sha) is not true then raise exception 'Valid legacy reference rejected';end if;
 if publish_import_source(legacy_id,legacy_expected,jsonb_build_object('storage_path',legacy_path,'storage_sha256',sha),legacy_archive,'cases/'||legacy_id||'/imports/legacy/'||repeat('d',64)||'.json',repeat('d',64)) is not false then raise exception 'Legacy pointer overwritten';end if;
 if has_function_privilege('anon','public.publish_import_workbook(uuid,text,text,text,bigint)','execute') or not has_function_privilege('service_role','public.publish_import_workbook(uuid,text,text,text,bigint)','execute') then raise exception 'Unexpected workbook privilege';end if;
 if has_function_privilege('anon','public.publish_import_source(uuid,jsonb,jsonb,jsonb,text,text)','execute') or not has_function_privilege('service_role','public.publish_import_source(uuid,jsonb,jsonb,jsonb,text,text)','execute') then raise exception 'Unexpected publication privilege';end if;
end $$;
