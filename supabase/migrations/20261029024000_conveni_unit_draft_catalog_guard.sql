-- Private groundwork only. A draft cannot be replayed against a different
-- catalog, even if its version ID and the service code are unchanged.
-- The value is an input fingerprint, not a completed economic decision.
alter table public.conveni_unit_economic_draft_events add column catalog_snapshot_hash text;

do $$
declare original text;patched text;
begin
 original:=pg_get_functiondef('public.prepare_conveni_unit_economic_draft(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,bigint,text,jsonb,jsonb,jsonb,jsonb,text)'::regprocedure);
 patched:=replace(original,
  $old$hashes_ jsonb;states_ jsonb;jobs_hash_ text;source_context_hash_ text;unit_identity_hash_ text;$old$,
  $new$hashes_ jsonb;states_ jsonb;jobs_hash_ text;source_context_hash_ text;unit_identity_hash_ text;catalog_snapshot_hash_ text;$new$);
 if patched=original then raise exception 'Expected economic draft declaration not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$if a.payload->'coverage_complete' is distinct from 'true'::jsonb$old$,
  $new$-- A version lock fences inserts through the version FK; locks on all
 -- existing rows fence edits, deletes and parent changes. NOWAIT prevents
 -- waiting behind a catalog publisher while other domain rows are locked.
 perform 1 from public.catalog_versions cv where cv.id=a.catalog_version_id for update nowait;
 if not found then raise exception 'Versió de catàleg no disponible' using errcode='PT409';end if;
 perform 1 from public.official_services os where os.version_id=a.catalog_version_id order by os.service_code for share nowait;
 select encode(extensions.digest(convert_to(jsonb_build_object(
  'version',(select to_jsonb(cv) from public.catalog_versions cv where cv.id=a.catalog_version_id),
  'services',(select coalesce(jsonb_agg(to_jsonb(os) order by os.service_code),'[]'::jsonb)
              from public.official_services os where os.version_id=a.catalog_version_id)
 )::text,'UTF8'),'sha256'),'hex') into catalog_snapshot_hash_;
 if a.payload->'coverage_complete' is distinct from 'true'::jsonb$new$);
 if patched=original then raise exception 'Expected economic draft validation point not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$and existing.document_revisions=p_revisions and existing.document_text_hashes=hashes_ and existing.document_state_hashes=states_ and existing.jobs_hash=jobs_hash_ and existing.catalog_version_id=a.catalog_version_id$old$,
  $new$and existing.document_revisions=p_revisions and existing.document_text_hashes=hashes_ and existing.document_state_hashes=states_ and existing.jobs_hash=jobs_hash_ and existing.catalog_version_id=a.catalog_version_id and existing.catalog_snapshot_hash=catalog_snapshot_hash_$new$);
 if patched=original then raise exception 'Expected economic draft replay point not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$document_revisions,document_text_hashes,document_state_hashes,jobs_hash,catalog_version_id,service_code,amount_cents$old$,
  $new$document_revisions,document_text_hashes,document_state_hashes,jobs_hash,catalog_version_id,catalog_snapshot_hash,service_code,amount_cents$new$);
 if patched=original then raise exception 'Expected economic draft insert fields not found';end if;
 original:=patched;
 patched:=replace(original,
  $old$p_revisions,hashes_,states_,jobs_hash_,a.catalog_version_id,p_service,p_amount_cents$old$,
  $new$p_revisions,hashes_,states_,jobs_hash_,a.catalog_version_id,catalog_snapshot_hash_,p_service,p_amount_cents$new$);
 if patched=original then raise exception 'Expected economic draft insert values not found';end if;
 execute patched;
end $$;

revoke all on function public.prepare_conveni_unit_economic_draft(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,bigint,text,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated,service_role;
