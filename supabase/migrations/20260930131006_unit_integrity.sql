alter table record_units drop constraint record_units_pipeline_job_id_fkey;
alter table record_units add foreign key(pipeline_job_id) references pipeline_jobs(id) on delete cascade;
alter table record_units drop constraint record_units_document_id_fkey;
alter table record_units add foreign key(document_id) references source_documents(id) on delete cascade;
-- Natural identity is stable: a retry with a different amount is a correction,
-- not a second financial transaction or an invisible update of an approved row.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.save_record_unit(uuid,uuid,jsonb)'::regprocedure);
 definition:=replace(definition,'return uid;',
 'if exists(select 1 from record_units where id=uid and amount is distinct from nullif(p_unit->>''amount'','''')::numeric) then raise exception ''Aquesta unitat ja existeix amb un altre import; revisa el desglossament abans de continuar.'';end if;
 return uid;');execute definition;
end $$;
