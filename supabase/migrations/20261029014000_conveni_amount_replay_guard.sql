-- Idempotent acknowledgement is valid only while the journaled effect is
-- still current. Never modify or reattribute historical operations.
alter table public.conveni_amount_operations
 add column replay_source_fingerprint text,
 add column replay_processing_status public.processing_status,
 add column revert_processing_status public.processing_status;
create or replace function public.migrate_conveni_amount(p_record uuid,p_operation uuid,p_hash text,p_before numeric) returns void
language plpgsql security invoker set search_path=public as $$
declare r source_records;op conveni_amount_operations;new_amount numeric;after_key text;source_fingerprint text;after_status public.processing_status;
begin
 select * into strict r from source_records where id=p_record and financing_type='conveni' for update nowait;
 source_fingerprint:=encode(extensions.digest(jsonb_build_object('source_dataset',r.source_dataset,'source_record_id',r.source_record_id,'title',r.title,'source_payload',r.source_payload,'source_payload_hash',r.source_payload_hash,'mechanism',r.mechanism,'financing_type',r.financing_type,'source_file',r.source_file,'source_sheet',r.source_sheet,'source_row',r.source_row,'import_run_id',r.import_run_id,'storage_path',r.storage_path,'storage_sha256',r.storage_sha256)::text,'sha256'),'hex');
 -- Existing rows can be updated/deleted without a new FK check. Lock them;
 -- the source row lock already fences new dependent inserts.
 perform 1 from review_decisions where source_record_id=r.id for share nowait;
 perform 1 from service_provisions where source_record_id=r.id for share nowait;
 perform 1 from conveni_amount_operations where source_record_id=r.id for update nowait;
 select * into op from conveni_amount_operations where id=p_operation for update nowait;
 if found then
  if op.source_record_id is distinct from r.id or op.source_hash is distinct from p_hash
   or op.before_amount is distinct from p_before or op.reverted_at is not null
   or op.identity_snapshot_captured is not true or op.after_amount is null or op.after_deduplication_key is null
   or op.replay_source_fingerprint is null or op.replay_processing_status is null
   or source_fingerprint is distinct from op.replay_source_fingerprint or r.processing_status is distinct from op.replay_processing_status
   or r.amount is distinct from op.after_amount or r.deduplication_key is distinct from op.after_deduplication_key
   or conveni_source_hash(r.id) is distinct from op.source_hash
   or exists(select 1 from review_decisions where source_record_id=r.id and created_at>=op.created_at)
   or exists(select 1 from service_provisions where source_record_id=r.id and superseded_at is null)
   or exists(select 1 from conveni_amount_operations later where later.source_record_id=r.id and later.id<>op.id and later.created_at>=op.created_at and later.reverted_at is null)
  then raise exception 'CONVENI_AMOUNT_REPLAY_STALE' using errcode='40001';end if;
  return;
 end if;
 if conveni_source_hash(r.id) is distinct from p_hash or r.amount is distinct from p_before then raise exception 'Simulació obsoleta' using errcode='40001';end if;
 if exists(select 1 from review_decisions where source_record_id=r.id and reviewer<>'system:convenis-sprint2-v1') or exists(select 1 from service_provisions where source_record_id=r.id and superseded_at is null) then raise exception 'El registre té una revisió o provisió activa';end if;
 new_amount:=conveni_public_amount(r.source_payload);if new_amount is null then raise exception 'Aportacions d’origen incompletes';end if;
 insert into conveni_amount_operations(id,source_record_id,source_hash,before_amount,after_amount,before_deduplication_key,identity_snapshot_captured,replay_source_fingerprint)
 values(p_operation,r.id,p_hash,r.amount,new_amount,r.deduplication_key,true,source_fingerprint);
 update source_records set amount=new_amount where id=r.id returning deduplication_key,processing_status into after_key,after_status;
 update conveni_amount_operations set after_deduplication_key=after_key,replay_processing_status=after_status where id=p_operation;
end $$;

create or replace function public.revert_conveni_amount(p_operation uuid) returns void
language plpgsql security invoker set search_path=public as $$
declare op conveni_amount_operations;r source_records;source_fingerprint text;after_status public.processing_status;
begin
 select * into strict op from conveni_amount_operations where id=p_operation for update;
 if not op.identity_snapshot_captured then raise exception 'L’operació històrica no conserva la identitat prèvia; requereix revisió específica';end if;
 select * into strict r from source_records where id=op.source_record_id and financing_type='conveni' for update nowait;
 perform 1 from review_decisions where source_record_id=r.id for share nowait;
 perform 1 from service_provisions where source_record_id=r.id for share nowait;
 perform 1 from conveni_amount_operations where source_record_id=r.id for update nowait;
 source_fingerprint:=encode(extensions.digest(jsonb_build_object('source_dataset',r.source_dataset,'source_record_id',r.source_record_id,'title',r.title,'source_payload',r.source_payload,'source_payload_hash',r.source_payload_hash,'mechanism',r.mechanism,'financing_type',r.financing_type,'source_file',r.source_file,'source_sheet',r.source_sheet,'source_row',r.source_row,'import_run_id',r.import_run_id,'storage_path',r.storage_path,'storage_sha256',r.storage_sha256)::text,'sha256'),'hex');
 if op.reverted_at is not null then
  if op.replay_source_fingerprint is null or op.revert_processing_status is null
   or source_fingerprint is distinct from op.replay_source_fingerprint or r.processing_status is distinct from op.revert_processing_status
   or r.amount is distinct from op.before_amount or r.deduplication_key is distinct from op.before_deduplication_key
   or conveni_source_hash(r.id) is distinct from op.source_hash
   or exists(select 1 from review_decisions where source_record_id=r.id and created_at>=op.created_at)
   or exists(select 1 from service_provisions where source_record_id=r.id and superseded_at is null)
   or exists(select 1 from conveni_amount_operations later where later.source_record_id=r.id and later.id<>op.id and later.created_at>=op.created_at and later.reverted_at is null)
  then raise exception 'CONVENI_AMOUNT_REVERT_REPLAY_STALE' using errcode='40001';end if;
  return;
 end if;
 if (op.replay_source_fingerprint is not null and source_fingerprint is distinct from op.replay_source_fingerprint) or r.amount is distinct from op.after_amount or r.deduplication_key is distinct from op.after_deduplication_key or conveni_source_hash(r.id) is distinct from op.source_hash or exists(select 1 from review_decisions where source_record_id=r.id and created_at>=op.created_at) or exists(select 1 from service_provisions where source_record_id=r.id and superseded_at is null) or exists(select 1 from conveni_amount_operations later where later.source_record_id=r.id and later.id<>op.id and later.created_at>=op.created_at and later.reverted_at is null) then raise exception 'El registre té canvis posteriors';end if;
 perform set_config('app.conveni_amount_revert',p_operation::text,true);
 update source_records set amount=op.before_amount,deduplication_key=op.before_deduplication_key where id=r.id returning processing_status into after_status;
 perform set_config('app.conveni_amount_revert','',true);
 update conveni_amount_operations set reverted_at=clock_timestamp(),revert_processing_status=after_status where id=p_operation;
end $$;
