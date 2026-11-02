-- Candidate: permit an independently approved line to be reviewed again
-- after a new analysis, with an explicit predecessor from the previous job.
do $$
declare s text;t text; a text; b text;
begin
 s:=pg_get_functiondef('public.concert_population_snapshot(uuid,uuid,uuid)'::regprocedure);
 a:='(u.pipeline_job_id is not null and u.pipeline_job_id<>p_job)';
 b:='(u.pipeline_job_id is not null and u.pipeline_job_id<>p_job and not (u.status=''approved'' and exists(select 1 from public.concert_line_award_decisions x where x.unit_id=u.id and x.source_record_id=p_record)))';
 if (length(s)-length(replace(s,a,'')))/length(a)<>1 then raise exception 'CROSS_JOB_POP_SNAPSHOT_ANCHOR';end if;
 execute replace(s,a,b);
 s:=pg_get_functiondef('public.concert_population_decide(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,integer,text,text,text,text,text)'::regprocedure);
 a:='if not ((u.status=''draft'' and u.reviewed_at is null) or (u.status=''approved'' and exists(select 1 from public.concert_line_award_decisions x where x.unit_id=u.id and x.job_id=p_job and x.source_record_id=p_record))) or (u.pipeline_job_id is not null and u.pipeline_job_id<>p_job) then raise exception ''POP_REVIEWED'';end if;';
 b:='if not ((u.status=''draft'' and u.reviewed_at is null and (u.pipeline_job_id is null or u.pipeline_job_id=p_job)) or (u.status=''approved'' and exists(select 1 from public.concert_line_award_decisions x where x.unit_id=u.id and x.source_record_id=p_record))) then raise exception ''POP_REVIEWED'';end if;';
 if (length(s)-length(replace(s,a,'')))/length(a)<>1 then raise exception 'CROSS_JOB_POP_DECIDE_ANCHOR';end if;
 execute replace(s,a,b);
 s:=pg_get_functiondef('public.concert_line_award_decide(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,uuid,text,uuid,text,uuid)'::regprocedure);
 a:='select * into prior from public.concert_line_award_decisions where unit_id=u.id and job_id=j.id order by sequence desc limit 1;';
 b:='select * into prior from public.concert_line_award_decisions where unit_id=u.id and source_record_id=r.id order by sequence desc,created_at desc,id desc limit 1;';
 if (length(s)-length(replace(s,a,'')))/length(a)<>1 then raise exception 'CROSS_JOB_AWARD_ANCHOR';end if;
 execute replace(s,a,b);
 s:=pg_get_functiondef('public.concert_line_award_archive_snapshot(uuid,uuid,uuid)'::regprocedure);
 a:='x.unit_id=u.id and x.job_id=j.id order by x.sequence desc limit 1';
 b:='x.unit_id=u.id and x.source_record_id=r.id order by x.sequence desc,x.created_at desc,x.id desc limit 1';
 if (length(s)-length(replace(s,a,'')))/length(a)<>2 then raise exception 'CROSS_JOB_AWARD_SNAPSHOT_ANCHOR';end if;
 execute replace(s,a,b);
end $$;
