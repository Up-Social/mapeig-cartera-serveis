-- New operations retain an auditable source fingerprint and status; stale
-- retries never overwrite or confirm a later revision.
insert into source_records(id,source_dataset,source_record_id,mechanism,title,amount,source_payload)
values('cccccccc-1810-4000-8000-000000000055','convenis','REPLAY-FIXTURE','Conveni','Synthetic',2000,'{"Total aportacions previstes Generalitat":0,"Total aportacions previstes ens locals":1000,"Total aportacions previstes altres Organismes":1000}');
do $$
declare sid uuid:='cccccccc-1810-4000-8000-000000000055';op uuid:=gen_random_uuid();h text;key_ text;fp text;status_ public.processing_status;review_ uuid;provision_ uuid;v text;code_ text;op2 uuid:=gen_random_uuid();sid2 uuid:=gen_random_uuid();op3 uuid:=gen_random_uuid();op4 uuid:=gen_random_uuid();h2 text;
begin
 h:=conveni_source_hash(sid);
 perform migrate_conveni_amount(sid,op,h,2000);perform migrate_conveni_amount(sid,op,h,2000);
 select after_deduplication_key,replay_source_fingerprint,replay_processing_status into key_,fp,status_ from conveni_amount_operations where id=op;
 update source_records set amount=777 where id=sid;
 begin perform migrate_conveni_amount(sid,op,h,2000);raise exception 'TEST: changed amount accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_AMOUNT_REPLAY_STALE' then raise;end if;end;
 if (select amount from source_records where id=sid)<>777 then raise exception 'Stale replay changed amount';end if;
 update source_records set amount=1000 where id=sid;
 update conveni_amount_operations set after_deduplication_key='different' where id=op;
 begin perform migrate_conveni_amount(sid,op,h,2000);raise exception 'TEST: changed identity accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_AMOUNT_REPLAY_STALE' then raise;end if;end;
 update conveni_amount_operations set after_deduplication_key=key_ where id=op;
 update source_records set mechanism='Different' where id=sid;
 if conveni_source_hash(sid) is distinct from h then raise exception 'Fixture must retain old MD5';end if;
 begin perform migrate_conveni_amount(sid,op,h,2000);raise exception 'TEST: changed source accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_AMOUNT_REPLAY_STALE' then raise;end if;end;
 update source_records set mechanism='Conveni' where id=sid;
 update source_records set storage_path='different',storage_sha256=repeat('a',64) where id=sid;
 begin perform migrate_conveni_amount(sid,op,h,2000);raise exception 'TEST: changed archive pointer accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_AMOUNT_REPLAY_STALE' then raise;end if;end;
 update source_records set storage_path=null,storage_sha256=null where id=sid;
 update source_records set processing_status='revisio' where id=sid;
 begin perform migrate_conveni_amount(sid,op,h,2000);raise exception 'TEST: changed status accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_AMOUNT_REPLAY_STALE' then raise;end if;end;
 update source_records set processing_status=status_ where id=sid;
 update conveni_amount_operations set replay_source_fingerprint=null where id=op;
 begin perform migrate_conveni_amount(sid,op,h,2000);raise exception 'TEST: historical ambiguous replay accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_AMOUNT_REPLAY_STALE' then raise;end if;end;
 update conveni_amount_operations set replay_source_fingerprint=fp where id=op;
 perform migrate_conveni_amount(sid,op,h,2000);
 insert into review_decisions(source_record_id,decision,reviewer) values(sid,'rejected','fixture') returning id into review_;
 begin perform revert_conveni_amount(op);raise exception 'TEST: revert ignored later review';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 delete from review_decisions where id=review_;
 select version_id,service_code into strict v,code_ from eligible_official_services limit 1;
 insert into service_provisions(source_record_id,source_id,mechanism,source_reference,service_code,catalog_version_id) values(sid,'synthetic','Conveni','synthetic',code_,v) returning id into provision_;
 begin perform revert_conveni_amount(op);raise exception 'TEST: revert ignored active provision';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 delete from service_provisions where id=provision_;
 -- Both operations use transaction_timestamp(); an equal timestamp cannot
 -- prove which effect came first, so the older one must not be reversed.
 perform migrate_conveni_amount(sid,op2,h,1000);
 if (select created_at from conveni_amount_operations where id=op2) is distinct from (select created_at from conveni_amount_operations where id=op) then raise exception 'Fixture timestamps differ';end if;
 begin perform revert_conveni_amount(op);raise exception 'TEST: equal-time later operation ignored';exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 delete from conveni_amount_operations where id=op2;
 perform revert_conveni_amount(op);perform revert_conveni_amount(op);
 -- A caller can supply a transaction-time timestamp on a later review,
 -- which is earlier than the clock timestamp captured by the revert.
 insert into review_decisions(source_record_id,decision,reviewer,created_at) values(sid,'rejected','fixture-after-revert',now()) returning id into review_;
 if (select created_at from review_decisions where id=review_) >= (select reverted_at from conveni_amount_operations where id=op) then raise exception 'Fixture requires transaction timestamp before revert';end if;
 begin perform revert_conveni_amount(op);raise exception 'TEST: same-transaction review after revert ignored';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_AMOUNT_REVERT_REPLAY_STALE' then raise;end if;end;
 delete from review_decisions where id=review_;
 update source_records set processing_status='revisio' where id=sid;
 begin perform revert_conveni_amount(op);raise exception 'TEST: changed revert status accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_AMOUNT_REVERT_REPLAY_STALE' then raise;end if;end;
 update source_records set processing_status=status_ where id=sid;
 update source_records set storage_path='different',storage_sha256=repeat('a',64) where id=sid;
 begin perform revert_conveni_amount(op);raise exception 'TEST: changed revert archive accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_AMOUNT_REVERT_REPLAY_STALE' then raise;end if;end;
 update source_records set storage_path=null,storage_sha256=null where id=sid;
 update source_records set amount=999 where id=sid;
 begin perform revert_conveni_amount(op);raise exception 'TEST: changed reverted amount accepted';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_AMOUNT_REVERT_REPLAY_STALE' then raise;end if;end;
 if (select amount from source_records where id=sid)<>999 then raise exception 'Stale revert changed amount';end if;
 -- A subsequent no-op amount correction has the same transaction timestamp
 -- and leaves amount and dedup identity unchanged; the active journal entry
 -- itself must prevent the older revert from being acknowledged.
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,amount,source_payload) values(sid2,'convenis',sid2::text,'Conveni','Synthetic no-op',1000,'{"Total aportacions previstes Generalitat":0,"Total aportacions previstes ens locals":1000,"Total aportacions previstes altres Organismes":1000}');
 h2:=conveni_source_hash(sid2);
 perform migrate_conveni_amount(sid2,op3,h2,1000);perform revert_conveni_amount(op3);perform migrate_conveni_amount(sid2,op4,h2,1000);
 if (select created_at from conveni_amount_operations where id=op3) is distinct from (select created_at from conveni_amount_operations where id=op4) then raise exception 'Fixture operation timestamps differ';end if;
 if (select amount from source_records where id=sid2)<>1000 or (select deduplication_key from source_records where id=sid2) is distinct from (select before_deduplication_key from conveni_amount_operations where id=op3) then raise exception 'Fixture changed restored amount or identity';end if;
 begin perform revert_conveni_amount(op3);raise exception 'TEST: same-time operation after revert ignored';exception when sqlstate '40001' then if sqlerrm<>'CONVENI_AMOUNT_REVERT_REPLAY_STALE' then raise;end if;end;
end $$;
