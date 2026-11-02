-- Experimental local-only commit: not granted to service_role until selection,
-- receipt recovery and archive-byte guarantees are integrated and verified.
create table public.local_matching_commits (
 job_id uuid primary key references public.pipeline_jobs(id) on delete cascade,
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
 result_hash text not null check(result_hash ~ '^[0-9a-f]{64}$'),
 committed_at timestamptz not null default clock_timestamp()
);
alter table public.local_matching_commits enable row level security;
revoke all on public.local_matching_commits from public,anon,authenticated,service_role;

-- Hash-only request intent; it records the trusted backend's attestation and
-- does not itself prove the request or normalized result is semantically correct.
create table public.local_matching_requests (
 job_id uuid not null references public.pipeline_jobs(id) on delete cascade,
 phase text not null check(phase in ('matching','positive-audit-v4')),
 input_hash text not null check(input_hash ~ '^local-matching-input-v1:[0-9a-f]{64}$'),
 wire_hash text not null check(wire_hash ~ '^prepared-json-v1:[0-9a-f]{64}$'),
 transform_hash text not null check(transform_hash ~ '^[0-9a-f]{64}$'),
 parent_response_hash text check(parent_response_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 primary key(job_id,phase),
 check((phase='matching' and parent_response_hash is null) or (phase='positive-audit-v4' and parent_response_hash is not null))
);
alter table public.local_matching_requests enable row level security;
revoke all on public.local_matching_requests from public,anon,authenticated,service_role;

create function public.local_register_matching_request(p_job uuid,p_expected jsonb,p_phase text,p_wire_hash text,p_transform_hash text,p_parent_response jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare input_ text; parent_hash_ text; prior local_matching_requests; matching_ local_matching_requests;
begin
 if p_job is null or p_phase is null or p_phase not in ('matching','positive-audit-v4')
  or coalesce(p_wire_hash,'') !~ '^prepared-json-v1:[0-9a-f]{64}$'
  or coalesce(p_transform_hash,'') !~ '^[0-9a-f]{64}$' then return false;end if;
 input_:=public.local_verify_matching_input_state(p_job,p_expected,'matching');
 if input_ is null then return false;end if;
 -- The capture holds job FOR UPDATE, preventing new receipt FK inserts until
 -- the transaction ends. Upgrade existing receipts NOWAIT before inspecting.
 perform 1 from provider_calls where pipeline_job_id=p_job for update nowait;
 perform 1 from analysis_results where pipeline_job_id=p_job for update nowait;
 perform 1 from matching_candidates where pipeline_job_id=p_job for update nowait;
 perform 1 from review_decisions where pipeline_job_id=p_job for share nowait;
 if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending')
  or exists(select 1 from local_matching_commits where job_id=p_job)
  or exists(select 1 from analysis_results where pipeline_job_id=p_job)
  or exists(select 1 from matching_candidates where pipeline_job_id=p_job)
  or exists(select 1 from review_decisions where pipeline_job_id=p_job) then return false;end if;
 if p_phase='matching' then
  if p_parent_response is not null then return false;end if;
 else
  if jsonb_typeof(p_parent_response) is distinct from 'object' then return false;end if;
  select * into matching_ from local_matching_requests where job_id=p_job and phase='matching' for update nowait;
  if not found or matching_.input_hash is distinct from input_
   or not exists(select 1 from provider_calls c where c.pipeline_job_id=p_job and c.phase='matching'
     and c.request_hash=matching_.wire_hash and c.state='received' and c.response=p_parent_response) then return false;end if;
  parent_hash_:=encode(extensions.digest(p_parent_response::text,'sha256'),'hex');
 end if;
 if exists(select 1 from provider_calls c where c.pipeline_job_id=p_job and not exists(
   select 1 from local_matching_requests q where q.job_id=p_job and q.phase=c.phase and q.wire_hash=c.request_hash
    and (c.state='received' or (c.phase=p_phase and c.state='retry' and c.attempts between 1 and 2)))) then return false;end if;
 select * into prior from local_matching_requests where job_id=p_job and phase=p_phase for update nowait;
 if found then
  return prior.input_hash is not distinct from input_ and prior.wire_hash is not distinct from p_wire_hash
   and prior.transform_hash is not distinct from p_transform_hash and prior.parent_response_hash is not distinct from parent_hash_
   and not exists(select 1 from provider_calls c where c.pipeline_job_id=p_job and c.phase=p_phase
    and (c.request_hash is distinct from p_wire_hash or not (c.state='received' or (c.state='retry' and c.attempts between 1 and 2))));
 end if;
 -- A receipt predating the intent has no provable provenance.
 if exists(select 1 from provider_calls where pipeline_job_id=p_job and phase=p_phase)
  or exists(select 1 from provider_calls where pipeline_job_id=p_job and phase not in ('matching','positive-audit-v4')) then return false;end if;
 insert into local_matching_requests(job_id,phase,input_hash,wire_hash,transform_hash,parent_response_hash)
 values(p_job,p_phase,input_,p_wire_hash,p_transform_hash,parent_hash_);
 return true;
exception when lock_not_available then return false;
end $$;
revoke all on function public.local_register_matching_request(uuid,jsonb,text,text,text,jsonb) from public,anon,authenticated,service_role;

-- Experimental atomic validation + existing journal claim. It is deliberately
-- private: the historical claim RPC remains callable and must be fenced before
-- enabling a local runner. Locks are released at transaction end, before I/O.
create function public.local_claim_matching_request(p_job uuid,p_expected jsonb,p_phase text,p_wire_hash text,p_transform_hash text,p_parent_response jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare enabled_ boolean;
begin
 -- The journal's insert trigger also locks this switch. Take the same lock
 -- first, without waiting, so a pause cannot strand domain locks behind it.
 select enabled into enabled_ from app_settings where key='processing_enabled' for share nowait;
 if enabled_ is not true then return null;end if;
 if public.local_register_matching_request(p_job,p_expected,p_phase,p_wire_hash,p_transform_hash,p_parent_response) is not true then return null;end if;
 return public.claim_provider_call(p_job,p_phase,p_wire_hash);
exception when lock_not_available then return null;
end $$;
revoke all on function public.local_claim_matching_request(uuid,jsonb,text,text,text,jsonb) from public,anon,authenticated,service_role;

create function public.local_matching_result_hash(p_job uuid,p_record uuid) returns text
language sql stable security definer set search_path=public as $$
 select encode(extensions.digest(jsonb_build_object(
  'job_status',j.status,'source_status',r.processing_status,
  'analysis',(select to_jsonb(a) from analysis_results a where a.pipeline_job_id=j.id),
  'candidates',(select coalesce(jsonb_agg(to_jsonb(c) order by c.rank,c.id),'[]'::jsonb) from matching_candidates c where c.pipeline_job_id=j.id),
  'candidate_evidence',(select coalesce(jsonb_agg(to_jsonb(e) order by e.candidate_id,e.evidence_chunk_id),'[]'::jsonb) from matching_candidate_evidence e join matching_candidates c on c.id=e.candidate_id where c.pipeline_job_id=j.id),
  'enrichment',(select to_jsonb(e) from record_enrichments e where e.source_record_id=r.id),
  'enrichment_evidence',(select coalesce(jsonb_agg(to_jsonb(ev) order by ev.evidence_chunk_id),'[]'::jsonb) from record_enrichment_evidence ev join record_enrichments e on e.id=ev.enrichment_id where e.source_record_id=r.id),
  'review_decisions',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]'::jsonb) from review_decisions d where d.pipeline_job_id=j.id)
 )::text,'sha256'),'hex') from pipeline_jobs j join source_records r on r.id=j.source_record_id where j.id=p_job and r.id=p_record
$$;
revoke all on function public.local_matching_result_hash(uuid,uuid) from public,anon,authenticated,service_role;

create function public.local_commit_matching(p_job uuid,p_expected jsonb,p_payload jsonb,p_receipts jsonb) returns boolean
language plpgsql security definer set search_path=public as $$
declare j pipeline_jobs; source_id uuid; existing local_matching_commits; request_hash_ text; effective_expected jsonb; verified text;
 enrich jsonb; receipt jsonb; anchor local_matching_requests; matching_response jsonb; ev jsonb; candidate jsonb; eid uuid; p_evidence jsonb; p_candidates jsonb; p_result jsonb; version_ text; mode_ text; phase_ text; hashes text[]:='{}';
begin
 if p_job is null or jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_payload) is distinct from 'object'
  or p_payload->>'version' is distinct from 'local-matching-commit-v1' or jsonb_typeof(p_receipts) is distinct from 'array' then return false;end if;
 select * into j from pipeline_jobs where id=p_job;
 if not found then return false;end if;
 source_id:=j.source_record_id;
 -- Align with the capture lock order. NOWAIT makes conflicting cloud/review
 -- writers fail this local attempt instead of waiting with partial locks.
 perform 1 from source_records where id=source_id for update nowait;
 perform 1 from pipeline_jobs where source_record_id=source_id for update nowait;
 perform 1 from provider_calls where pipeline_job_id=p_job for update nowait;
 if exists(select 1 from provider_calls where pipeline_job_id=p_job and state='sending') then return false;end if;
 perform 1 from analysis_results where pipeline_job_id=p_job for update nowait;
 perform 1 from matching_candidates where pipeline_job_id=p_job for update nowait;
 perform 1 from matching_candidate_evidence e join matching_candidates c on c.id=e.candidate_id where c.pipeline_job_id=p_job for update of e nowait;
 perform 1 from review_decisions where pipeline_job_id=p_job for share nowait;
 perform 1 from record_enrichments where source_record_id=source_id for update nowait;
 perform 1 from record_enrichment_evidence ee join record_enrichments e on e.id=ee.enrichment_id where e.source_record_id=source_id for update of ee nowait;
 request_hash_:=encode(extensions.digest(jsonb_build_object('job',p_job,'input',p_expected,'payload',p_payload,'receipts',p_receipts)::text,'sha256'),'hex');
 p_result:=p_payload->'result';p_candidates:=p_payload->'candidates';p_evidence:=p_payload->'evidence';enrich:=p_payload->'enrichment';
 mode_:=p_payload->>'mode';version_:=p_expected->'catalog_version'->>'id';
 if mode_ not in ('provider','deterministic') or mode_ is null or jsonb_typeof(p_result) is distinct from 'object'
  or jsonb_typeof(p_candidates) is distinct from 'array' or jsonb_typeof(p_evidence) is distinct from 'array'
  or jsonb_array_length(p_evidence)<1 or coalesce(version_,'')='' then return false;end if;
 if mode_='provider' and jsonb_array_length(p_receipts) not between 1 and 2 then return false;end if;
 if mode_='provider' and ((p_expected->'enrichment'='null'::jsonb and coalesce(enrich,'null'::jsonb)='null'::jsonb)
  or (p_expected->'enrichment'<>'null'::jsonb and coalesce(enrich,'null'::jsonb)<>'null'::jsonb)) then return false;end if;
 if mode_='deterministic' and (jsonb_array_length(p_receipts)<>0 or p_result->>'classification' is distinct from 'insufficient_evidence' or coalesce(enrich,'null'::jsonb)<>'null'::jsonb) then return false;end if;
 -- No deterministic conclusion may reinterpret any earlier provider receipt,
 -- including enrichment or an unknown historical phase.
 if mode_='deterministic' and (exists(select 1 from provider_calls where pipeline_job_id=p_job) or exists(select 1 from local_matching_requests where job_id=p_job)) then return false;end if;
 for receipt in select value from jsonb_array_elements(p_receipts) loop
  phase_:=receipt->>'phase';
  if phase_ not in ('matching','positive-audit-v4') or phase_ is null or phase_=any(hashes)
   or coalesce(receipt->>'wire_hash','') !~ '^prepared-json-v1:[0-9a-f]{64}$' or jsonb_typeof(receipt->'response') is distinct from 'object' then return false;end if;
  hashes:=array_append(hashes,phase_);
  select * into anchor from local_matching_requests where job_id=p_job and phase=phase_ for update nowait;
  if not found or anchor.input_hash is distinct from 'local-matching-input-v1:'||encode(extensions.digest(p_expected::text,'sha256'),'hex')
   or anchor.wire_hash is distinct from receipt->>'wire_hash' or anchor.transform_hash is distinct from p_payload->>'transform_hash'
   or not exists(select 1 from provider_calls c where c.pipeline_job_id=p_job and c.phase=phase_ and c.request_hash=anchor.wire_hash and c.state='received' and c.response=receipt->'response') then return false;end if;
 end loop;
 if 'positive-audit-v4'=any(hashes) then
  select x->'response' into matching_response from jsonb_array_elements(p_receipts) x where x->>'phase'='matching';
  if matching_response is null or not exists(select 1 from local_matching_requests q where q.job_id=p_job and q.phase='positive-audit-v4'
   and q.parent_response_hash=encode(extensions.digest(matching_response::text,'sha256'),'hex')) then return false;end if;
 end if;
 if mode_='provider' and exists(select 1 from local_matching_requests q where q.job_id=p_job and not (q.phase=any(hashes))) then return false;end if;
 if mode_='provider' and not ('matching'=any(hashes)) then return false;end if;
 -- Until the exact-code exception is independently verifiable here, require
 -- an audit receipt for any positive result; this is necessary, not sufficient.
 if mode_='provider' and p_result->>'classification'='in_portfolio' and not ('positive-audit-v4'=any(hashes)) then return false;end if;
 if exists(select 1 from provider_calls c where c.pipeline_job_id=p_job
   and not exists(select 1 from jsonb_array_elements(p_receipts) x where x->>'phase'=c.phase and x->>'wire_hash'=c.request_hash and c.state='received' and x->'response'=c.response)) then return false;end if;
 select * into existing from local_matching_commits where job_id=p_job for update nowait;
 if found then
  if existing.request_hash is distinct from request_hash_ or existing.result_hash is distinct from public.local_matching_result_hash(p_job,source_id) then return false;end if;
  effective_expected:=p_expected;
  -- The enrichment created by this commit must itself match result_hash above;
  -- substitute it only for checking the rest of the original capture.
  if p_payload->'enrichment' is distinct from 'null'::jsonb and p_payload ? 'enrichment' then
   effective_expected:=jsonb_set(effective_expected,'{enrichment}',coalesce((select jsonb_build_object('id',e.id,'summary',e.summary,'provider_name',e.provider_name,'provider_nif',e.provider_nif,'mechanism',e.mechanism,'award_date',e.award_date,'amount',e.amount,'contracting_body',e.contracting_body,'target_population',e.target_population,'scope_facts',e.scope_facts) from record_enrichments e where e.source_record_id=source_id),'null'::jsonb));
  end if;
  return public.local_verify_matching_input_state(p_job,effective_expected,'needs_review') is not null;
 end if;
 verified:=public.local_verify_matching_input_state(p_job,p_expected,'matching');
 if verified is null or exists(select 1 from analysis_results where pipeline_job_id=p_job)
  or exists(select 1 from matching_candidates where pipeline_job_id=p_job)
  or exists(select 1 from review_decisions where pipeline_job_id=p_job) then return false;end if;
 -- Every cited row, not just one candidate per service, must be active and
 -- identical to the captured content rather than merely in the same record.
 for ev in select value from jsonb_array_elements(p_evidence) union all
  select e.value from jsonb_array_elements(p_candidates) c cross join lateral jsonb_array_elements(case when jsonb_typeof(c.value->'evidence')='array' then c.value->'evidence' else '[]'::jsonb end) e loop
  if jsonb_typeof(ev) is distinct from 'object' or not exists(select 1 from current_evidence_chunks c join source_documents d on d.id=c.source_document_id
   where c.id::text=ev->>'id' and c.source_document_id::text=ev->>'source_document_id' and c.ordinal::text=ev->>'ordinal'
    and c.content=ev->>'content' and d.source_record_id=source_id and d.status='fetched') then return false;end if;
 end loop;
 if coalesce(enrich,'null'::jsonb)<>'null'::jsonb then
  if mode_<>'provider' or p_expected->'enrichment' is distinct from 'null'::jsonb or jsonb_typeof(enrich) is distinct from 'object'
   or jsonb_typeof(p_payload->'enrichment_evidence') is distinct from 'array' or jsonb_array_length(p_payload->'enrichment_evidence')<1 then return false;end if;
  for ev in select value from jsonb_array_elements(p_payload->'enrichment_evidence') loop
   if not exists(select 1 from current_evidence_chunks c join source_documents d on d.id=c.source_document_id where c.id::text=ev#>>'{}' and d.source_record_id=source_id and d.status='fetched') then return false;end if;
  end loop;
  insert into record_enrichments(source_record_id,extracted_title,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,scope_facts,summary,confidence,engine,engine_version,updated_at)
  values(source_id,enrich->>'title',enrich->>'provider_name',enrich->>'provider_nif',enrich->>'mechanism',nullif(enrich->>'award_date','')::date,(enrich->>'amount')::numeric,enrich->>'contracting_body',enrich->>'target_population',nullif(enrich->'scope_facts','null'::jsonb),enrich->>'summary',(enrich->>'confidence')::numeric,'openai-responses',enrich->>'engine_version',now()) returning id into eid;
  insert into record_enrichment_evidence(enrichment_id,evidence_chunk_id) select eid,(x#>>'{}')::uuid from jsonb_array_elements(p_payload->'enrichment_evidence') x group by x;
  update source_records set enrichment_status='completed',enrichment_error=null,updated_at=now() where id=source_id;
 end if;
 perform public.persist_analysis(p_job,version_,p_result,p_candidates,p_evidence);
 insert into local_matching_commits(job_id,request_hash,result_hash) values(p_job,request_hash_,public.local_matching_result_hash(p_job,source_id));
 return true;
exception when lock_not_available then return false;
end $$;
revoke all on function public.local_commit_matching(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
