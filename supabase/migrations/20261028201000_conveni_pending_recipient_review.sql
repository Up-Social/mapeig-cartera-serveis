-- A review-by-recipient container is not an aggregate finding of insufficient
-- evidence. While any unit remains in review, keep technical incidents first
-- and route the case to review without assigning a global classification.
do $$
declare definition text; patched text; needle text; replacement text;
begin
 definition:=pg_get_viewdef('public.current_record_results'::regclass,true);
 needle:=$n$ELSE COALESCE(d.classification, a.reviewed_classification, a.classification)$n$;
 replacement:=$n$WHEN a.rule_audit ->> 'rule'::text = 'review_by_recipient'::text AND j.status = 'needs_review'::text THEN NULL::text
            ELSE COALESCE(d.classification, a.reviewed_classification, a.classification)$n$;
 patched:=replace(definition,needle,replacement);
 if patched=definition then raise exception 'Expected classification expression not found';end if;
 definition:=patched;
 needle:=$n$WHEN r.financing_type = 'concert'::text AND COALESCE(d.classification, a.reviewed_classification, a.classification) = 'out_of_portfolio'::text$n$;
 replacement:=$n$WHEN a.rule_audit ->> 'rule'::text = 'review_by_recipient'::text AND j.status = 'needs_review'::text THEN 'review'::text
            WHEN r.financing_type = 'concert'::text AND COALESCE(d.classification, a.reviewed_classification, a.classification) = 'out_of_portfolio'::text$n$;
 patched:=replace(definition,needle,replacement);
 if patched=definition then raise exception 'Expected destination expression not found';end if;
 definition:=patched;
 needle:=$n$d.id IS NOT NULL OR a.reviewed_classification IS NOT NULL AS human_reviewed$n$;
 replacement:=$n$CASE WHEN a.rule_audit ->> 'rule'::text = 'review_by_recipient'::text AND j.status = 'needs_review'::text THEN false ELSE d.id IS NOT NULL OR a.reviewed_classification IS NOT NULL END AS human_reviewed$n$;
 patched:=replace(definition,needle,replacement);
 if patched=definition then raise exception 'Expected review expression not found';end if;
 definition:=patched;
 needle:=$n$d.decision AS review_decision$n$;
 replacement:=$n$CASE WHEN a.rule_audit ->> 'rule'::text = 'review_by_recipient'::text AND j.status = 'needs_review'::text THEN NULL::text ELSE d.decision END AS review_decision$n$;
 patched:=replace(definition,needle,replacement);
 if patched=definition then raise exception 'Expected decision expression not found';end if;
 execute 'create or replace view public.current_record_results with (security_invoker=true) as '||patched;
end $$;
