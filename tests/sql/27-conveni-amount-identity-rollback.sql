-- Run inside the SQL runner's rollback transaction.
insert into source_records(id,source_dataset,source_record_id,mechanism,title,amount,source_payload)
values('cccccccc-1810-4000-8000-000000000001','convenis','PILOT-LEGACY-IDENTITY','Conveni','Conveni de prova de reversió',2000,
'{"Total aportacions previstes Generalitat":0,"Total aportacions previstes ens locals":1000,"Total aportacions previstes altres Organismes":1000}');
alter table source_records disable trigger zz_conveni_identity;
update source_records set deduplication_key='historical-before-migration' where id='cccccccc-1810-4000-8000-000000000001';
alter table source_records enable trigger zz_conveni_identity;
do $$declare sid uuid:='cccccccc-1810-4000-8000-000000000001';op uuid:=gen_random_uuid();h text;begin
 h:=conveni_source_hash(sid);
 perform migrate_conveni_amount(sid,op,h,2000);
 if (select amount from source_records where id=sid)<>1000 then raise exception 'Amount not corrected';end if;
 if (select deduplication_key from source_records where id=sid)='historical-before-migration' then raise exception 'Expected stable new document identity';end if;
 perform revert_conveni_amount(op);
 if (select amount from source_records where id=sid)<>2000 or (select deduplication_key from source_records where id=sid)<>'historical-before-migration' then raise exception 'Historical amount and identity were not both restored';end if;
 perform revert_conveni_amount(op);
end $$;
