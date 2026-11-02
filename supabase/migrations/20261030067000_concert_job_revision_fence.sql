-- Freeze all jobs that can affect the effective Concert job, including a later
-- verification-only job which may be changed by an administrative writer.
-- Source rows are already held FOR UPDATE first; the immediate source-record
-- FK fences concurrent inserts or reassignment into these records. NOWAIT
-- avoids waiting on a writer with the reverse lock order.
do $$
declare original text;patched text;anchor text;addition text;signature text;
begin
 signature:='public.concert_line_export_commit(uuid,text,jsonb)';
 original:=pg_get_functiondef(signature::regprocedure);
 anchor:=' perform 1 from public.pipeline_jobs j where j.id in(select x.job_id from public.concert_line_award_decisions x where x.id=any(ids)) order by j.id for share nowait;';
 addition:=' perform 1 from public.pipeline_jobs j where j.source_record_id in(select x.source_record_id from public.concert_line_award_decisions x where x.id=any(ids)) order by j.id for share nowait;';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'CONCERT_EXPORT_JOB_FENCE_ANCHOR';end if;
 patched:=replace(original,anchor,addition);execute patched;
 signature:='public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid)';
 original:=pg_get_functiondef(signature::regprocedure);
 anchor:=' select * into strict r from public.source_records where id=p_record and financing_type=''concert'' for update;';
 addition:=E'\n perform 1 from public.pipeline_jobs where source_record_id=p_record order by id for share nowait;';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'CONCERT_AWARD_JOB_FENCE_ANCHOR';end if;
 patched:=replace(original,anchor,anchor||addition);execute patched;
 signature:='public.concert_population_decide(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,integer,text,text,text,text,text)';
 original:=pg_get_functiondef(signature::regprocedure);
 anchor:=' if r.financing_type is distinct from ''concert'' then raise exception ''POP_SCOPE'';end if;';
 if (length(original)-length(replace(original,anchor,'')))/length(anchor)<>1 then raise exception 'CONCERT_POPULATION_JOB_FENCE_ANCHOR';end if;
 patched:=replace(original,anchor,anchor||addition);execute patched;
end $$;
