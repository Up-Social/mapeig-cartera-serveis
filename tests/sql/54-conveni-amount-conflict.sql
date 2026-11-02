-- Isolated fixture trigger only. The SQL runner wraps and rolls back this test.
create function pg_temp.test_conveni_dedup_conflict() returns trigger language plpgsql as $$
begin
 if old.id='cccccccc-1810-4000-8000-000000000054' and current_setting('test.conveni_conflict',true)='on' then
  raise exception 'T19_DEDUP_BUSY' using errcode='40001';
 end if;
 return new;
end $$;
create trigger zzzz_test_conveni_dedup_conflict before update of amount on public.source_records for each row execute function pg_temp.test_conveni_dedup_conflict();
insert into source_records(id,source_dataset,source_record_id,mechanism,title,amount,source_payload)
values('cccccccc-1810-4000-8000-000000000054','convenis','CONFLICT-FIXTURE','Conveni','Synthetic',2000,'{"Total aportacions previstes Generalitat":0,"Total aportacions previstes ens locals":1000,"Total aportacions previstes altres Organismes":1000}');
do $$
declare sid uuid:='cccccccc-1810-4000-8000-000000000054';op uuid:=gen_random_uuid();h text;before_key text;
begin
 h:=conveni_source_hash(sid);select deduplication_key into before_key from source_records where id=sid;
 perform set_config('test.conveni_conflict','on',true);
 begin perform migrate_conveni_amount(sid,op,h,2000);raise exception 'TEST: conflict did not abort';exception when sqlstate '40001' then if sqlerrm<>'T19_DEDUP_BUSY' then raise;end if;end;
 if (select amount from source_records where id=sid)<>2000 or exists(select 1 from conveni_amount_operations where id=op) then raise exception 'Failed apply left partial state';end if;
 perform set_config('test.conveni_conflict','off',true);
 perform migrate_conveni_amount(sid,op,h,2000);perform migrate_conveni_amount(sid,op,h,2000);
 if (select amount from source_records where id=sid)<>1000 or (select count(*) from conveni_amount_operations where id=op)<>1 then raise exception 'Apply retry not idempotent';end if;
 perform set_config('test.conveni_conflict','on',true);
 begin perform revert_conveni_amount(op);raise exception 'TEST: revert conflict did not abort';exception when sqlstate '40001' then if sqlerrm<>'T19_DEDUP_BUSY' then raise;end if;end;
 if (select amount from source_records where id=sid)<>1000 or (select reverted_at from conveni_amount_operations where id=op) is not null then raise exception 'Failed revert left partial state';end if;
 perform set_config('test.conveni_conflict','off',true);
 perform revert_conveni_amount(op);perform revert_conveni_amount(op);
 if (select amount from source_records where id=sid)<>2000 or (select deduplication_key from source_records where id=sid) is distinct from before_key then raise exception 'Revert retry failed';end if;
end $$;
