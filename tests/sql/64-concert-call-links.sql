do $$
declare earlier uuid:=gen_random_uuid();later uuid:=gen_random_uuid();kind_ text;
begin
 insert into source_records(id,source_dataset,source_record_id,mechanism,title,source_payload)
 values(earlier,'concerts',earlier::text,'Concert','Convocatòria sintètica','{}'),
       (later,'concerts',later::text,'Concert','Provisió sintètica','{}');
 insert into concert_record_links(later_record_id,earlier_record_id,link_kind,matching_method,evidence)
 values(later,earlier,'call','explicit_resolution','Referència documental sintètica');
 if not exists(select 1 from concert_record_links where later_record_id=later and link_kind='call' and status='candidate')
 then raise exception 'TEST: call must remain a candidate';end if;
 foreach kind_ in array array['amendment','renewal','modification','termination','cession','appeal','validation','other'] loop
  update concert_record_links set link_kind=kind_ where later_record_id=later and earlier_record_id=earlier;
 end loop;
 begin
  update concert_record_links set link_kind='unsupported' where later_record_id=later and earlier_record_id=earlier;
  raise exception 'TEST: unknown link kind accepted';
 exception when check_violation then null;end;
 if exists(select 1 from record_units where source_record_id in (earlier,later))
  or exists(select 1 from service_provisions where source_record_id in (earlier,later))
 then raise exception 'TEST: procedural link must not create economic data';end if;
end $$;
