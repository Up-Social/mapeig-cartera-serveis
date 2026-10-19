-- Selective amount corrections must also restore the pre-migration identity.
-- Historical rows can still have the previous amount-based deduplication key.
alter table public.conveni_amount_operations
 add column before_deduplication_key text,
 add column after_deduplication_key text,
 add column identity_snapshot_captured boolean not null default false;

create or replace function public.set_conveni_identity() returns trigger
language plpgsql set search_path=public as $$
declare operation public.conveni_amount_operations; requested text;
begin
 if new.source_dataset='convenis' then
  requested:=current_setting('app.conveni_amount_revert',true);
  if tg_op='UPDATE' and coalesce(requested,'')<>'' then
   select * into operation from conveni_amount_operations where id::text=requested and source_record_id=new.id and identity_snapshot_captured and reverted_at is null;
   if not found or operation.source_hash is distinct from conveni_source_hash(new.id)
    or new.amount is distinct from operation.before_amount or old.amount is distinct from operation.after_amount
    or old.deduplication_key is distinct from operation.after_deduplication_key then raise exception 'Reversió d’identitat obsoleta' using errcode='40001';end if;
   new.deduplication_key:=operation.before_deduplication_key;
  else new.deduplication_key:=md5('convenis|'||new.source_record_id);end if;
 end if;
 return new;
end $$;

create or replace function public.migrate_conveni_amount(p_record uuid,p_operation uuid,p_hash text,p_before numeric) returns void
language plpgsql security invoker set search_path=public as $$
declare r source_records;new_amount numeric;after_key text;
begin
 select * into strict r from source_records where id=p_record and financing_type='conveni' for update;
 if exists(select 1 from conveni_amount_operations where id=p_operation and source_record_id=r.id and source_hash=p_hash and before_amount is not distinct from p_before and reverted_at is null) then return;end if;
 if conveni_source_hash(r.id) is distinct from p_hash or r.amount is distinct from p_before then raise exception 'Simulació obsoleta' using errcode='40001';end if;
 if exists(select 1 from review_decisions where source_record_id=r.id and reviewer<>'system:convenis-sprint2-v1') or exists(select 1 from service_provisions where source_record_id=r.id and superseded_at is null) then raise exception 'El resultat revisat requereix revisió humana específica';end if;
 new_amount:=conveni_public_amount(r.source_payload);if new_amount is null then raise exception 'Aportacions d’origen incompletes';end if;
 insert into conveni_amount_operations(id,source_record_id,source_hash,before_amount,after_amount,before_deduplication_key,identity_snapshot_captured)
 values(p_operation,r.id,p_hash,r.amount,new_amount,r.deduplication_key,true);
 update source_records set amount=new_amount where id=r.id returning deduplication_key into after_key;
 update conveni_amount_operations set after_deduplication_key=after_key where id=p_operation;
end $$;

create or replace function public.revert_conveni_amount(p_operation uuid) returns void
language plpgsql security invoker set search_path=public as $$
declare op conveni_amount_operations;r source_records;
begin
 select * into strict op from conveni_amount_operations where id=p_operation for update;
 if op.reverted_at is not null then return;end if;
 if not op.identity_snapshot_captured then raise exception 'L’operació històrica no conserva la identitat prèvia; requereix revisió específica';end if;
 select * into strict r from source_records where id=op.source_record_id for update;
 if r.amount is distinct from op.after_amount or r.deduplication_key is distinct from op.after_deduplication_key or conveni_source_hash(r.id) is distinct from op.source_hash or exists(select 1 from review_decisions where source_record_id=r.id and created_at>=op.created_at) or exists(select 1 from conveni_amount_operations where source_record_id=r.id and created_at>op.created_at and reverted_at is null) then raise exception 'El registre té canvis posteriors';end if;
 perform set_config('app.conveni_amount_revert',p_operation::text,true);
 update source_records set amount=op.before_amount,deduplication_key=op.before_deduplication_key where id=r.id;
 perform set_config('app.conveni_amount_revert','',true);
 update conveni_amount_operations set reverted_at=clock_timestamp() where id=op.id;
end $$;
