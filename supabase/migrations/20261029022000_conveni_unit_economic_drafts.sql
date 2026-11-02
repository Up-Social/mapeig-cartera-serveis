-- Private groundwork only. Drafts are not approvals, do not publish sources,
-- and do not establish the identity/version of bytes served by Storage.
create table public.conveni_unit_economic_draft_events (
 id uuid primary key,
 source_record_id uuid not null references public.source_records(id),
 job_id uuid not null, unit_id uuid not null,
 sequence integer not null check(sequence>0), previous_id uuid references public.conveni_unit_economic_draft_events(id),
 contract_version text not null default 'conveni-unit-economic-draft-v1' check(contract_version='conveni-unit-economic-draft-v1'),
 parent_review_id uuid references public.conveni_review_events(id),
 source_hash text not null, source_context_hash text not null, unit_identity_hash text not null, proposal_hash text not null, analysis_hash text not null,
 document_revisions jsonb not null, document_text_hashes jsonb not null, document_state_hashes jsonb not null, jobs_hash text not null,
 catalog_version_id text not null references public.catalog_versions(id), service_code text not null,
 amount_cents bigint not null, amount_state text not null, amount_literal text not null,
 monetary_citation jsonb not null, identity_citation jsonb not null, role_period_citation jsonb not null,
 confirmations jsonb not null, reason text not null, proposal_snapshot jsonb not null,
 actor text not null default 'local_user', created_at timestamptz not null default clock_timestamp(),
 foreign key(job_id,unit_id) references public.conveni_unit_proposals(job_id,unit_id),
 unique(job_id,unit_id,sequence)
);
alter table public.conveni_unit_economic_draft_events enable row level security;
revoke all on public.conveni_unit_economic_draft_events from public,anon,authenticated,service_role;

-- Mirror the existing shared TypeScript coverage check. A known incomplete PDF
-- is rejected; a legacy recognized PDF without coverage metadata is not proof
-- of complete physical coverage and remains a separate operational limitation.
create function public.conveni_economic_draft_coverage(p_method text,p_coverage jsonb,p_mime text,p_partial boolean) returns boolean
language sql immutable security invoker set search_path=pg_catalog as $$
 select p_partial is false and p_coverage->'complete' is distinct from 'false'::jsonb and coalesce(
  case when p_method='html-basic' or position('html' in coalesce(p_mime,''))>0 or p_mime='text/plain'
   then p_coverage->>'policy'='html-text-coverage-v1' and p_coverage->'complete'='true'::jsonb
   else p_method ~ '^(pdf-(text|ocr)-markdown-v2|pdftotext(-layout)?|pdf-text)$' end,false)
$$;
revoke all on function public.conveni_economic_draft_coverage(text,jsonb,text,boolean) from public,anon,authenticated,service_role;

create function public.prepare_conveni_unit_economic_draft(
 p_record uuid,p_job uuid,p_unit uuid,p_event uuid,p_previous uuid,p_parent_review uuid,
 p_source_hash text,p_proposal_hash text,p_analysis_hash text,p_revisions jsonb,p_service text,
 p_amount_cents bigint,p_amount_literal text,p_monetary jsonb,p_identity jsonb,p_role_period jsonb,
 p_confirmations jsonb,p_reason text
) returns void language plpgsql security invoker set search_path=pg_catalog,public,extensions as $$
declare r public.source_records;a public.conveni_analyses;u public.record_units;d jsonb;doc public.source_documents;
 citation jsonb;parent_ uuid;last_ public.conveni_unit_economic_draft_events;existing public.conveni_unit_economic_draft_events;
 hashes_ jsonb;states_ jsonb;jobs_hash_ text;source_context_hash_ text;unit_identity_hash_ text;
begin
 select * into strict r from public.source_records where id=p_record for update;
 -- The FK on source_record_id blocks new jobs behind the record lock, while
 -- existing jobs can otherwise change ordering or verification_only in place.
 perform 1 from public.pipeline_jobs j where j.source_record_id=r.id order by j.id for share nowait;
 select * into strict a from public.conveni_analyses where job_id=p_job and source_record_id=r.id for update;
 perform 1 from public.record_units ru where ru.source_record_id=r.id order by ru.id for update nowait;
 select * into strict u from public.record_units where id=p_unit and source_record_id=r.id;
 perform 1 from public.conveni_unit_proposals cp where cp.job_id=p_job order by cp.unit_id for share;
 select data into strict d from public.conveni_unit_proposals where job_id=p_job and unit_id=p_unit;
 if r.financing_type is distinct from 'conveni' or p_event is null
  or p_job is distinct from (select id from public.pipeline_jobs where source_record_id=r.id and not verification_only order by created_at desc,id desc limit 1)
  or a.source_hash is distinct from p_source_hash or a.source_hash is distinct from public.conveni_source_hash(r.id)
  or a.document_revisions is distinct from p_revisions or jsonb_typeof(p_revisions) is distinct from 'object'
  or p_proposal_hash is distinct from encode(extensions.digest(d::text,'sha256'),'hex')
  or p_analysis_hash is distinct from encode(extensions.digest(a.payload::text,'sha256'),'hex')
 then raise exception 'Anàlisi, proposta o manifest obsolets' using errcode='PT409';end if;
 -- Unit lock blocks new event FK insertions; existing events remain mutable
 -- for privileged historical writers, so hold them stable as well.
 perform 1 from public.conveni_review_events e where e.unit_id=p_unit order by e.id for share nowait;
 select id into parent_ from public.conveni_review_events where unit_id=p_unit order by created_at desc,id desc limit 1;
 if parent_ is distinct from p_parent_review then raise exception 'Revisió de la unitat obsoleta' using errcode='PT409';end if;
 if parent_ is not null and exists(select 1 from public.conveni_review_events successor where successor.unit_id=p_unit and successor.id<>parent_
  and successor.snapshot->>'replay_previous'=parent_::text) then raise exception 'Revisió posterior detectada' using errcode='PT409';end if;
 -- Ordering by wall clock cannot certify an arbitrary historical event chain.
 -- Until that chain is audited, even a seemingly current parent remains blocked.
 if parent_ is not null then raise exception 'Les revisions anteriors requereixen validació del seu historial abans de preparar l’atribució' using errcode='PT409';end if;
 if u.unit_key is distinct from 'conveni:'||(d->>'key')
  or (select count(*) from jsonb_array_elements(case when jsonb_typeof(a.payload->'units')='array' then a.payload->'units' else '[]'::jsonb end) item where item.value=d)<>1
 then raise exception 'Unitat o proposta diferents de l’anàlisi; cal una correcció humana versionada' using errcode='PT409';end if;
 if a.payload->'coverage_complete' is distinct from 'true'::jsonb
  or d->>'recipient_nature' is distinct from 'private' or d->'joint' is distinct from 'false'::jsonb or d->'mixed' is distinct from 'false'::jsonb
  or jsonb_typeof(d->'blockers') is distinct from 'array' or jsonb_array_length(case when jsonb_typeof(d->'blockers')='array' then d->'blockers' else '[]'::jsonb end)<>0
  or (d ? 'concepts' and d->'concepts'<>'null'::jsonb and (jsonb_typeof(d->'concepts') is distinct from 'array' or jsonb_array_length(case when jsonb_typeof(d->'concepts')='array' then d->'concepts' else '[]'::jsonb end)>0))
  or public.conveni_identity_words(d->>'recipient')='' or public.conveni_identity_words(d->>'period')=''
  or coalesce(d->>'recipient_nif','') !~ '^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$'
  or d->>'classification' is distinct from 'in_portfolio' or d->>'service_code' is distinct from p_service
  or coalesce(d->>'amount_state','') not in ('planned','conditional','confirmed')
  or jsonb_typeof(d->'amount_cents') is distinct from 'number' or coalesce(d->>'amount_cents','') !~ '^[0-9]+$'
  or p_amount_cents is null or p_amount_cents<0 or p_amount_cents>9007199254740991
  or (d->>'amount_cents')::numeric is distinct from p_amount_cents::numeric
  or public.conveni_group_literal_cents(p_amount_literal) is distinct from p_amount_cents::numeric
  or not public.conveni_quote_has_amount_literal(p_monetary->>'quote',p_amount_literal)
  or not public.conveni_identity_quote_matches(d->>'recipient',d->>'recipient_nif',p_identity->>'quote')
  or not exists(select 1 from public.eligible_official_services where version_id=a.catalog_version_id and service_code=p_service)
 then raise exception 'Unitat, import o identitat pendents de documentar';end if;
 if jsonb_typeof(p_confirmations) is distinct from 'object' or exists(select 1 from unnest(array['public_contribution','recipient_role','period','not_shared_or_maximum','conditions_preserved','not_payment']) k where p_confirmations->k is distinct from 'true'::jsonb)
  or length(trim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'Cal confirmar i justificar l’atribució econòmica';end if;
 -- This check proves literal text in the current extracted page, not the
 -- reviewer assertions or the identity of physical object bytes.
 perform 1 from public.source_documents sd where sd.source_record_id=r.id order by sd.id for share nowait;
 if exists(select 1 from public.source_documents sd where sd.source_record_id=r.id and sd.document_type in ('agreement','annex')
    and (sd.status<>'fetched' or not public.conveni_economic_draft_coverage(sd.extraction_method,sd.extraction_coverage,sd.mime_type,sd.extraction_partial) or sd.storage_sha256 is null or sd.storage_path is null
      or sd.storage_sha256 !~ '^[0-9a-f]{64}$' or sd.extracted_text is null
      or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
      or a.document_revisions->>sd.id::text is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,'')))
  or exists(select 1 from jsonb_each_text(p_revisions) rev left join public.source_documents sd on sd.id::text=rev.key
    where sd.id is null or sd.source_record_id<>r.id or coalesce(sd.document_type,'') not in ('agreement','annex') or sd.status<>'fetched'
     or not public.conveni_economic_draft_coverage(sd.extraction_method,sd.extraction_coverage,sd.mime_type,sd.extraction_partial) or sd.storage_sha256 is null or sd.storage_path is null or sd.extracted_text is null
     or coalesce(sd.quality_flags,'{}') && array['corrupt_text','incomplete_extraction']
     or rev.value is distinct from sd.storage_sha256||':'||coalesce(sd.active_extraction_id::text,''))
 then raise exception 'Cobertura documental canviada' using errcode='PT409';end if;
 -- Existing analysis contract is bounded at 180,000 JS characters; four
 -- UTF-8 bytes per character gives a conservative upper bound for hashing.
 if (select count(*) from public.source_documents sd where sd.source_record_id=r.id and sd.document_type in ('agreement','annex'))>502
  or (select coalesce(sum(octet_length(sd.extracted_text)),0) from public.source_documents sd where sd.source_record_id=r.id and sd.document_type in ('agreement','annex'))>720000
 then raise exception 'Cobertura documental supera el límit de preparació';end if;
 foreach citation in array array[p_monetary,p_identity,p_role_period] loop
  if jsonb_typeof(citation) is distinct from 'object' or coalesce(citation->>'page','') !~ '^[1-9][0-9]{0,5}$'
   or length(coalesce(citation->>'quote',''))>4000 then raise exception 'Cita invàlida';end if;
  select * into doc from public.source_documents where id::text=citation->>'document_id' and source_record_id=r.id and document_type in ('agreement','annex');
  if not found or not public.conveni_citation_on_page(doc.extracted_text,(citation->>'page')::integer,citation->>'quote') then raise exception 'Cita no verificable a la pàgina indicada';end if;
 end loop;
 select jsonb_object_agg(sd.id::text,encode(extensions.digest(sd.extracted_text,'sha256'),'hex') order by sd.id) into hashes_
 from public.source_documents sd where sd.source_record_id=r.id and sd.document_type in ('agreement','annex');
 select jsonb_object_agg(sd.id::text,encode(extensions.digest(jsonb_build_object('url',sd.url,'document_type',sd.document_type,'status',sd.status,
  'extraction_partial',sd.extraction_partial,'storage_path',sd.storage_path,'storage_sha256',sd.storage_sha256,
  'active_extraction_id',sd.active_extraction_id,'quality_flags',sd.quality_flags,'extraction_method',sd.extraction_method,
  'extraction_version',sd.extraction_version,'extraction_coverage',sd.extraction_coverage,'mime_type',sd.mime_type,
  'content_hash',sd.content_hash,'extracted_text_hash',sd.extracted_text_hash,'text_length',sd.text_length)::text,'sha256'),'hex') order by sd.id) into states_
 from public.source_documents sd where sd.source_record_id=r.id and sd.document_type in ('agreement','annex');
 select encode(extensions.digest(jsonb_build_object('id',r.id,'source_dataset',r.source_dataset,'source_record_id',r.source_record_id,
  'financing_type',r.financing_type,'mechanism',r.mechanism,'title',r.title,'provider_name',r.provider_name,'amount',r.amount,
  'source_file',r.source_file,'source_sheet',r.source_sheet,'source_row',r.source_row,'source_payload',r.source_payload,
  'source_payload_hash',r.source_payload_hash,'import_run_id',r.import_run_id,'storage_path',r.storage_path,'storage_sha256',r.storage_sha256,
  'deduplication_key',r.deduplication_key)::text,'sha256'),'hex') into source_context_hash_;
 select encode(extensions.digest(to_jsonb(u)::text,'sha256'),'hex') into unit_identity_hash_;
 select encode(extensions.digest(coalesce(jsonb_agg(jsonb_build_object('id',j.id,'run_id',j.run_id,'source_record_id',j.source_record_id,
  'verification_only',j.verification_only,'created_at',j.created_at) order by j.id),'[]'::jsonb)::text,'sha256'),'hex') into jobs_hash_
 from public.pipeline_jobs j where j.source_record_id=r.id;
 select * into last_ from public.conveni_unit_economic_draft_events where job_id=p_job and unit_id=p_unit order by sequence desc limit 1;
 select * into existing from public.conveni_unit_economic_draft_events where id=p_event;
 if found then
  if last_.id=existing.id and existing.source_record_id=p_record and existing.job_id=p_job and existing.unit_id=p_unit
   and existing.contract_version='conveni-unit-economic-draft-v1' and existing.previous_id is not distinct from p_previous and existing.parent_review_id is not distinct from p_parent_review
   and existing.source_hash=p_source_hash and existing.source_context_hash=source_context_hash_ and existing.unit_identity_hash=unit_identity_hash_ and existing.proposal_hash=p_proposal_hash and existing.analysis_hash=p_analysis_hash
   and existing.document_revisions=p_revisions and existing.document_text_hashes=hashes_ and existing.document_state_hashes=states_ and existing.jobs_hash=jobs_hash_ and existing.catalog_version_id=a.catalog_version_id
   and existing.service_code=p_service and existing.amount_cents=p_amount_cents and existing.amount_state=d->>'amount_state'
   and existing.amount_literal=p_amount_literal and existing.monetary_citation=p_monetary and existing.identity_citation=p_identity
   and existing.role_period_citation=p_role_period and existing.confirmations=p_confirmations and existing.reason=p_reason
  then return;end if;
  raise exception 'Identificador de preparació reutilitzat o obsolet' using errcode='PT409';
 end if;
 if last_.id is distinct from p_previous then raise exception 'Preparació obsoleta' using errcode='PT409';end if;
 insert into public.conveni_unit_economic_draft_events(id,source_record_id,job_id,unit_id,sequence,previous_id,parent_review_id,source_hash,source_context_hash,unit_identity_hash,proposal_hash,analysis_hash,document_revisions,document_text_hashes,document_state_hashes,jobs_hash,catalog_version_id,service_code,amount_cents,amount_state,amount_literal,monetary_citation,identity_citation,role_period_citation,confirmations,reason,proposal_snapshot)
 values(p_event,r.id,p_job,p_unit,coalesce(last_.sequence,0)+1,p_previous,p_parent_review,p_source_hash,source_context_hash_,unit_identity_hash_,p_proposal_hash,p_analysis_hash,p_revisions,hashes_,states_,jobs_hash_,a.catalog_version_id,p_service,p_amount_cents,d->>'amount_state',p_amount_literal,p_monetary,p_identity,p_role_period,p_confirmations,p_reason,d);
end $$;
revoke all on function public.prepare_conveni_unit_economic_draft(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,bigint,text,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role;
