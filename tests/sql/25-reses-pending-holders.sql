-- Synthetic identities only, executed in the isolated DB inside a rolled-back transaction.
do $$
declare e uuid; normal uuid; again uuid; code text; manifest jsonb; before_doc jsonb; n integer; total integer; result jsonb;
begin
 insert into entities(legal_name,normalized_name,nif,validation_status) values('null','null','NULL','reses_verified') returning id into e;
 insert into entity_aliases(entity_id,alias,normalized_alias,source) values(e,'null','null','reses');
 insert into reses_services(registry_number,entity_id,service_name,service_type,source_payload,source_payload_hash,retrieved_at)
 values('S99001',e,'Servei prova 1','Tipologia prova','{"nif":"null","entitat_titular":"null","original":1}','hash-1',now()),
 ('S99002',e,'Servei prova 2','Tipologia prova','{"nif":"null","entitat_titular":"null","original":2}','hash-2',now());
 normal:=ensure_reses_entity('G12345678','Entitat real de prova',null);
 again:=ensure_reses_entity('G12345678','Un altre nom no substitueix el primer',null);
 if normal<>again or (select count(*) from entities where nif='G12345678')<>1 then raise exception 'Entity deduplication failed';end if;
 begin
  perform ensure_reses_entity('NULL','null',null);raise exception 'TEST: placeholder accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 insert into reses_services(registry_number,entity_id,service_name,service_type,source_payload,source_payload_hash,retrieved_at)
 values('S12277',normal,'Excluded sentinel','Tipologia prova','{}','excluded-hash',now());
 select service_code into code from master_services limit 1;
 if code is null then
  insert into master_services(service_code,service_name,source_file,source_sheet,source_row,source_payload,source_payload_hash) values('test-reses','Servei prova','synthetic.xlsx','Fixture',4,'{}','fixture');code:='test-reses';
 end if;
 insert into entity_catalog_relations(entity_id,service_code,relation_type,source_type,source_reference,evidence) values(e,code,'auxiliary','reses','S99001','Observació original');
 select jsonb_agg(jsonb_build_object('registry_number',registry_number,'source_payload_hash',source_payload_hash) order by registry_number) into manifest from reses_services where entity_id=e;
 select count(*) into total from reses_services;
 before_doc:=reses_identity_snapshot(e,manifest);
 begin
  perform repair_reses_missing_holder(e,manifest||manifest,'test-reses-duplicate','Test reviewer',total,1);raise exception 'TEST: duplicate manifest accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform repair_reses_missing_holder(e,jsonb_set(manifest,'{0,source_payload_hash}','"changed"'),'test-reses-stale','Test reviewer',total,1);raise exception 'TEST: stale hash accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 insert into source_record_entities(source_record_id,entity_id,role,origin,evidence) values('aaaaaaaa-0000-4000-8000-000000000001',e,'provider','source','Synthetic dependency');
 begin
  perform repair_reses_missing_holder(e,manifest,'test-reses-dependency','Test reviewer',total,1);raise exception 'TEST: new dependency ignored';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 delete from source_record_entities where entity_id=e;
 result:=repair_reses_missing_holder(e,manifest,'test-reses-operation','Test reviewer',total,1);
 if result->>'status'<>'applied' or (select count(*) from reses_services where entity_id is null and registry_number in ('S99001','S99002'))<>2 then raise exception 'Pending services missing';end if;
 if exists(select 1 from entities where id=e and (active or nif is not null or validation_status<>'unverified')) then raise exception 'Placeholder remains canonical';end if;
 if (select count(*) from entity_catalog_relations where entity_id=e and retired_at is not null)<>1 or (select count(*) from reses_catalog_observations where registry_number='S99001' and retired_at is null)<>1 then raise exception 'Auxiliary observations not preserved';end if;
 if reses_identity_snapshot(e,manifest)->'unaffected_hash'<>before_doc->'unaffected_hash' or (select source_payload_hash from reses_services where registry_number='S12277')<>'excluded-hash' then raise exception 'Excluded services changed';end if;
 if (select count(*) from reses_services)<>total or (select count(*) from entity_aliases where entity_id=e)<>1 then raise exception 'Original rows lost';end if;
 select count(*) into n from reses_holder_history;
 result:=repair_reses_missing_holder(e,manifest,'test-reses-operation','Test reviewer',total,1);
 if result->>'status'<>'already_applied' or (select count(*) from reses_holder_history)<>n then raise exception 'Retry is not idempotent';end if;
 update reses_services set capacity=999 where registry_number='S99001';
 begin
  perform rollback_reses_holder_repair('test-reses-operation','Test reviewer');raise exception 'TEST: overwrote later correction';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 if (select capacity from reses_services where registry_number='S99001')<>999 then raise exception 'Later correction lost';end if;
 update reses_services set capacity=null where registry_number='S99001';
 result:=rollback_reses_holder_repair('test-reses-operation','Test reviewer');
 if result->>'status'<>'reverted' or reses_identity_snapshot(e,manifest)->'services'<>before_doc->'services' or reses_identity_snapshot(e,manifest)->'entity'<>before_doc->'entity' then raise exception 'Rollback did not restore exact original';end if;
 if not exists(select 1 from reses_identity_operations where kind='rollback' and reverses='test-reses-operation') or (select count(*) from reses_holder_history)<>n+2 then raise exception 'Rollback history lost';end if;
 if rollback_reses_holder_repair('test-reses-operation','Test reviewer')->>'status'<>'already_reverted' then raise exception 'Rollback not idempotent';end if;
 if has_function_privilege('anon','public.repair_reses_missing_holder(uuid,jsonb,text,text,integer,integer)','execute') or has_table_privilege('authenticated','public.reses_identity_operations','select') then raise exception 'Private audit exposed';end if;
end $$;
