-- Conveni scope screening v2. Rules are evaluated in TypeScript
-- (lib/convenis/scope.ts) from the Excel row before any document or model
-- call; this function re-checks each rule's invariant and persists it.
-- `auto` keeps the historical audited discard when no human decision exists.
-- `proposal` stores a discard proposal for human confirmation: the job stays
-- in needs_review and no system review decision is written.
create or replace function public.screen_conveni_v2(p_job uuid,p_reason text,p_rule text,p_version text,p_mode text,p_explanation text) returns boolean
language plpgsql security invoker set search_path=public as $$
declare j pipeline_jobs;r source_records;v text;auto boolean;ev jsonb;others text;rule_ok boolean;
begin
 select * into strict j from pipeline_jobs where id=p_job;
 select * into strict r from source_records where id=j.source_record_id for update;
 if r.financing_type<>'conveni' then return false;end if;
 if j.id is distinct from (select id from pipeline_jobs where source_record_id=r.id and not verification_only order by created_at desc,id desc limit 1) then raise exception 'Revisió obsoleta' using errcode='PT409';end if;
 if exists(select 1 from conveni_analyses where job_id=j.id) then return true;end if;
 if p_reason is null or exists(select 1 from conveni_scope_overrides where source_record_id=r.id and source_hash=conveni_source_hash(r.id)) then return false;end if;
 others:=coalesce(r.source_payload->>'Altres Organismes Signants','');
 -- Evaluated before IF: PL/pgSQL reads an IF condition up to the first THEN.
 rule_ok:=case p_rule
  when 'excluded_amendment' then p_reason='excluded_amendment' and p_mode='auto' and conveni_scope_reason(r.title,'{}'::jsonb)='excluded_amendment'
  when 'interadministrative_agreement' then p_reason='interadministrative_agreement' and p_mode='auto' and conveni_scope_reason(r.title,'{}'::jsonb)='interadministrative_agreement'
  when 'no_public_funding' then p_reason='no_public_funding' and p_mode='auto' and conveni_public_amount(r.source_payload)=0
  when 'interadministrative_signatories' then p_reason='interadministrative_agreement' and p_mode='proposal' and others ~ '^[[:space:];]*$'
  when 'interadministrative_public_others' then p_reason='interadministrative_agreement' and p_mode='proposal' and others !~ '^[[:space:];]*$'
  else false end;
 if not coalesce(rule_ok,false) or length(trim(coalesce(p_explanation,'')))<20 or coalesce(p_version,'')=''
 then raise exception 'Regla d’abast de conveni no vàlida per a aquest registre' using errcode='P0001',detail='CONVENI_SCOPE_RULE_INVALID';end if;
 select id into strict v from catalog_versions where active and validated;
 auto:=p_mode='auto'
  and not exists(select 1 from review_decisions where source_record_id=r.id and reviewer<>'system:convenis-sprint2-v1')
  and not exists(select 1 from service_provisions where source_record_id=r.id and superseded_at is null);
 ev:=jsonb_build_array(jsonb_build_object('kind','source_row','content',p_explanation,'title',r.title,'file',r.source_file,'sheet',r.source_sheet,'row',r.source_row,'payload',r.source_payload));
 insert into conveni_analyses(job_id,source_record_id,source_hash,catalog_version_id,payload,exclusion_reason,automatic)
 values(j.id,r.id,conveni_source_hash(r.id),v,jsonb_build_object('summary',p_explanation,'units','[]'::jsonb,'actors','[]'::jsonb,'scope_rule',p_rule,'scope_version',p_version),p_reason,auto);
 insert into analysis_results(pipeline_job_id,source_record_id,catalog_version_id,rules_version,classification,reasons,explanation,service_description,target_population,evidence,rule_audit,reviewed_classification,reviewed_reasons,reviewed_at)
 values(j.id,r.id,v,'convenis-sprint2-v1','discarded',jsonb_build_array(p_reason),p_explanation,'','',ev,
  jsonb_build_object('version','convenis-sprint2-v1','scope_version',p_version,'actor',case when auto then 'system' else 'proposal' end,'rule',case when p_rule in ('excluded_amendment','interadministrative_agreement','no_public_funding') then p_reason else p_rule end,'reason',p_reason)
   ||case when auto then '{}'::jsonb else jsonb_build_object('proposal',jsonb_build_object('kind','discard','reason',p_reason,'rule',p_rule,'source','excel','requires_review',true)) end,
  case when auto then 'discarded' end,case when auto then array[p_reason] else '{}' end,case when auto then now() end);
 if auto then
  insert into review_decisions(source_record_id,pipeline_job_id,classification,reasons,decision,reason,reviewer)
  values(r.id,j.id,'discarded',array[p_reason],'rejected',p_explanation,'system:convenis-sprint2-v1');
 end if;
 update pipeline_jobs set status=case when auto then 'rejected' else 'needs_review' end,completed_at=now() where id=j.id;
 update source_records set processing_status=(case when auto then 'rebutjat' else 'revisio' end)::processing_status,updated_at=now() where id=r.id;
 perform refresh_pipeline_run(j.run_id);
 return true;
end $$;

create or replace function public.cloud_screen_conveni_v2(p_task uuid,p_owner uuid,p_generation bigint,p_job uuid,p_reason text,p_rule text,p_version text,p_mode text,p_explanation text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
 perform public.cloud_assert_lease(p_task,p_owner,p_generation);
 if not exists(select 1 from public.worker_tasks t join public.pipeline_jobs j on j.id=p_job
  where t.id=p_task and ((t.run_id is not null and j.run_id=t.run_id) or (t.source_record_id is not null and j.source_record_id=t.source_record_id))
  and (t.pipeline_job_id is null or t.pipeline_job_id=j.id)) then raise exception 'CLOUD_SCOPE';end if;
 return public.screen_conveni_v2(p_job,p_reason,p_rule,p_version,p_mode,p_explanation);
end $$;

revoke all on function public.screen_conveni_v2(uuid,text,text,text,text,text),public.cloud_screen_conveni_v2(uuid,uuid,bigint,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.screen_conveni_v2(uuid,text,text,text,text,text),public.cloud_screen_conveni_v2(uuid,uuid,bigint,uuid,text,text,text,text,text) to service_role;
