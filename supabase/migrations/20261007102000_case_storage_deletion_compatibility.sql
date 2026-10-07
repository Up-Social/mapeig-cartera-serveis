-- Legacy cloud checkpoints use task/document/hash; new ones use case/document/hash.
do $$ declare definition text;changed text;begin
 definition:=pg_get_functiondef('public.delete_discarded_records(jsonb,integer)'::regprocedure);
 changed:=replace(definition,
  '(split_part(c.value->>''path'',''/'',2)<>substring(c.item_key from 10) or split_part(c.value->>''path'',''/'',1)<>c.task_id::text)',
  'not ((split_part(c.value->>''path'',''/'',1)=c.task_id::text and split_part(c.value->>''path'',''/'',2)=substring(c.item_key from 10)) or exists(select 1 from source_documents sd where sd.id::text=substring(c.item_key from 10) and c.value->>''path'' like ''cases/''||sd.source_record_id||''/documents/''||sd.id||''/%''))');
 if changed=definition then raise exception 'Checkpoint path guard patch target missing';end if;
 execute changed;
end $$;
