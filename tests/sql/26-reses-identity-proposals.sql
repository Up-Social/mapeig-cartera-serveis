-- Isolated synthetic records; surrounding transaction is always rolled back.
do $$
declare manifest jsonb; result jsonb; before_services jsonb; n integer; invalid jsonb;
begin
 insert into reses_services(registry_number,entity_id,service_name,service_type,source_payload,source_payload_hash,retrieved_at)
 values('S99003',null,'Prova proposta 1','Tipologia prova','{"original":1}','proposal-hash-1',now()),
 ('S99004',null,'Prova proposta 2','Tipologia prova','{"original":2}','proposal-hash-2',now());
 select jsonb_agg(to_jsonb(s) order by registry_number) into before_services from reses_services s;
 select count(*) into n from reses_holder_history;
 select jsonb_agg(jsonb_build_object('registry_number',registry_number,'source_payload_hash',source_payload_hash,
  'proposed_name','Entitat sintètica','proposed_nif','G12345678','role',case when registry_number='S99003' then 'documented_manager' else 'program_association' end,
  'supported_from','2024-01-01','supported_to','2024-12-31','limitations','Només proveïdor històric; titularitat actual no confirmada.',
  'evidence',jsonb_build_array(jsonb_build_object('url','https://example.org/prova.pdf','description','Resolució sintètica amb codi i NIF',
    'consulted_at','2026-10-15','page',2,'format','pdf','sha256',repeat('a',64),
    'storage_path','references/reses/'||registry_number||'/proposals/test-reses-proposals/'||repeat('a',64)||'.pdf'))) order by registry_number)
 into manifest from reses_services where registry_number in ('S99003','S99004');
 begin
  perform record_reses_identity_proposals('test-reses-proposals',manifest||manifest,'Prova autoritzada');raise exception 'TEST: duplicate manifest';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 begin
  perform record_reses_identity_proposals('test-reses-proposals',jsonb_set(manifest,'{1,role}','"confirmed_holder"'),'Prova autoritzada');raise exception 'TEST: holder confirmation accepted';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 if exists(select 1 from reses_identity_proposals) then raise exception 'Partial write survived failed manifest';end if;
 begin
  perform record_reses_identity_proposals('test-reses-proposals',jsonb_set(manifest,'{0,source_payload_hash}','"obsolete"'),'Prova autoritzada');raise exception 'TEST: obsolete source';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 invalid:=jsonb_set(manifest,'{0,evidence,0,storage_path}','"cases/unrelated/file.pdf"');
 begin
  perform record_reses_identity_proposals('test-reses-proposals',invalid,'Prova autoritzada');raise exception 'TEST: unrelated archive';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 invalid:=jsonb_set(manifest,'{0,limitations}','""');
 begin
  perform record_reses_identity_proposals('test-reses-proposals',invalid,'Prova autoritzada');raise exception 'TEST: missing limits';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 result:=record_reses_identity_proposals('test-reses-proposals',manifest,'Prova autoritzada');
 if result->>'status'<>'applied' or (select count(*) from reses_identity_proposals)<>2 or (select count(*) from reses_identity_proposal_events)<>2 then raise exception 'Proposals/history missing';end if;
 if (select payload->>'role' from reses_identity_proposals where registry_number='S99003')<>'documented_manager'
  or (select payload->>'role' from reses_identity_proposals where registry_number='S99004')<>'program_association' then raise exception 'Documented relationship types were not preserved';end if;
 result:=record_reses_identity_proposals('test-reses-proposals',jsonb_build_array(manifest->1,manifest->0),'Prova autoritzada');
 if result->>'status'<>'already_applied' or (select count(*) from reses_identity_proposal_events)<>2 then raise exception 'Retry duplicates proposals/history';end if;
 begin
  perform record_reses_identity_proposals('test-reses-other-key',replace(manifest::text,'test-reses-proposals','test-reses-other-key')::jsonb,'Prova autoritzada');raise exception 'TEST: same evidence duplicated with another operation';
 exception when unique_violation then null;end;
 if (select count(*) from reses_identity_proposals)<>2 or (select count(*) from reses_identity_proposal_events)<>2 then raise exception 'Semantic duplicate survived';end if;
 begin
  perform record_reses_identity_proposals('test-reses-proposals',jsonb_set(manifest,'{0,proposed_name}','"Un altre nom"'),'Prova autoritzada');raise exception 'TEST: operation reused';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 if before_services<>(select jsonb_agg(to_jsonb(s) order by registry_number) from reses_services s) or n<>(select count(*) from reses_holder_history) then raise exception 'Proposal changed original services or holder history';end if;
 if has_function_privilege('anon','public.record_reses_identity_proposals(text,jsonb,text)','execute')
  or has_table_privilege('authenticated','public.reses_identity_proposal_overview','select')
  or has_table_privilege('service_role','public.reses_identity_proposals','update')
  or has_table_privilege('service_role','public.reses_identity_proposal_events','delete') then raise exception 'Unexpected permissions';end if;
 result:=withdraw_reses_identity_proposals('test-reses-proposals','Prova autoritzada','Reversió sintètica sense esborrar dades');
 if result->>'status'<>'withdrawn' or (select count(*) from reses_identity_proposal_overview where withdrawn)<>2
  or (select count(*) from reses_identity_proposals)<>2 or (select count(*) from reses_identity_proposal_events)<>4 then raise exception 'Withdrawal lost history';end if;
 if withdraw_reses_identity_proposals('test-reses-proposals','Prova autoritzada','Reversió sintètica repetida')->>'status'<>'already_withdrawn' then raise exception 'Withdrawal not idempotent';end if;
 begin
  perform record_reses_identity_proposals('test-reses-proposals',manifest,'Prova autoritzada');raise exception 'TEST: withdrawn proposals reactivated';
 exception when raise_exception then if sqlerrm like 'TEST:%' then raise;end if;end;
 if before_services<>(select jsonb_agg(to_jsonb(s) order by registry_number) from reses_services s) then raise exception 'Withdrawal changed services';end if;
end $$;
