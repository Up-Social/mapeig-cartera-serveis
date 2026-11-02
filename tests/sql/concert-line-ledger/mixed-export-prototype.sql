-- Private fixture only: unified snapshot for legacy and separate line awards.
create table public.experimental_mixed_receipts(id uuid primary key,hash text not null);
create table public.experimental_mixed_items(receipt_id uuid not null references public.experimental_mixed_receipts(id),provision_id uuid not null,snapshot jsonb not null,primary key(receipt_id,provision_id));
revoke all on public.experimental_mixed_receipts,public.experimental_mixed_items from public,anon,authenticated,service_role;
create function public.experimental_mixed_snapshot(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'snapshot',to_jsonb(p)||jsonb_build_object('service_name',coalesce(o.service_name,p.service_code),'source_records',jsonb_build_object('financing_type',r.financing_type))) order by p.id),'[]')
 from public.experimental_combined_provisions() p join public.source_records r on r.id=p.source_record_id
 left join public.official_services o on o.version_id=p.catalog_version_id and o.service_code=p.service_code
 where p.id=any(p_ids) and p.superseded_at is null and (exists(select 1 from public.concert_line_awards a where a.id=p.id)
  or p.mechanism='Conveni' or (r.processing_status='completat' and (select d.decision from public.review_decisions d where d.source_record_id=r.id order by d.created_at desc,d.id desc limit 1) in ('approved','corrected')))
$$;
revoke all on function public.experimental_mixed_snapshot(uuid[]) from public,anon,authenticated,service_role;
-- Private experiment: lock sources and the dependencies of the existing view.
create function public.experimental_mixed_commit(p_receipt uuid,p_hash text,p_expected jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ids uuid[];sources uuid[];actual jsonb;old_hash text;old_items jsonb;
begin
 if p_receipt is null or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_expected)<>'array' or jsonb_array_length(p_expected)=0 then raise exception 'MIXED_INVALID';end if;
 select array_agg((e->>'id')::uuid order by (e->>'id')::uuid),array_agg(distinct (e->'snapshot'->>'source_record_id')::uuid order by (e->'snapshot'->>'source_record_id')::uuid) into ids,sources from jsonb_array_elements(p_expected) e;
 if array_position(ids,null) is not null or array_position(sources,null) is not null or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'MIXED_INVALID';end if;
 select hash into old_hash from public.experimental_mixed_receipts where id=p_receipt;
 if found then
  select coalesce(jsonb_agg(jsonb_build_object('id',provision_id,'snapshot',snapshot) order by provision_id),'[]') into old_items from public.experimental_mixed_items where receipt_id=p_receipt;
  if old_hash is distinct from p_hash or old_items is distinct from p_expected then raise exception 'MIXED_REPLAY_CONFLICT';end if;
  return p_receipt;
 end if;
 perform 1 from public.source_records r where r.id=any(sources) order by r.id for update nowait;
 perform 1 from public.pipeline_jobs j where j.source_record_id=any(sources) order by j.id for update nowait;
 perform 1 from public.record_units u where u.source_record_id=any(sources) order by u.id for update nowait;
 perform 1 from public.source_documents d where d.source_record_id=any(sources) order by d.id for share nowait;
 perform 1 from public.review_decisions d where d.source_record_id=any(sources) order by d.id for share nowait;
 perform 1 from public.conveni_analyses a where a.source_record_id=any(sources) order by a.job_id for update nowait;
 perform 1 from public.conveni_unit_proposals cp join public.conveni_analyses a on a.job_id=cp.job_id where a.source_record_id=any(sources) order by cp.job_id,cp.unit_id for update of cp nowait;
 perform 1 from public.conveni_review_events e where e.source_record_id=any(sources) order by e.id for update nowait;
 perform 1 from public.service_provisions p where p.id=any(ids) order by p.id for share nowait;
 perform 1 from public.official_services o where (o.version_id,o.service_code) in(select e->'snapshot'->>'catalog_version_id',e->'snapshot'->>'service_code' from jsonb_array_elements(p_expected) e) order by o.version_id,o.service_code for share nowait;
 perform 1 from storage.objects o where o.id in(select x.source_object_id from public.concert_line_award_decisions x where x.provision_id=any(ids) union select x.item_object_id from public.concert_line_award_decisions x where x.provision_id=any(ids)) order by o.id for share nowait;
 actual:=public.experimental_mixed_snapshot(ids);
 if jsonb_array_length(actual)<>cardinality(ids) or actual is distinct from p_expected then raise exception 'MIXED_STALE' using errcode='40001';end if;
 insert into public.experimental_mixed_receipts values(p_receipt,p_hash);
 insert into public.experimental_mixed_items select p_receipt,(e->>'id')::uuid,e->'snapshot' from jsonb_array_elements(actual) e;
 return p_receipt;
end $$;
revoke all on function public.experimental_mixed_commit(uuid,text,jsonb) from public,anon,authenticated,service_role;
create trigger mixed_receipt_immutable before update or delete on public.experimental_mixed_receipts for each row execute function public.concert_line_immutable_history();
create trigger mixed_item_immutable before update or delete on public.experimental_mixed_items for each row execute function public.concert_line_immutable_history();
