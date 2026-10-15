do $$ begin
 if imported_priority_value('convenis','{"Data signatura":"25/03/2024","Data vigència":"2025-01-01"}','date')<>'2024-03-25' then raise exception 'Signature date precedence';end if;
 if imported_priority_value('raisc_ccaa','{"Data concessió":"2024-12-01T00:00:00.000Z","CIF Beneficiari":"G12345678"}','nif')<>'G12345678' then raise exception 'Beneficiary identity precedence';end if;
 if imported_priority_value('contractacions','{"Fecha de la última publicación":"2025-01-01"}','date') is not null then raise exception 'Publication used as award date';end if;
 if imported_priority_value('convenis','{"Data signatura":"31/02/2024"}','date') is not null then raise exception 'Invalid date accepted';end if;
 if imported_priority_value('raisc_local','{"Tipus de beneficiaris":"Administració pública"}','population') is not null then raise exception 'Recipient used as final population';end if;
 if position('imported_priority_value(r.source_dataset, r.source_payload' in pg_get_functiondef('public.review_analysis(uuid,text,uuid,text[],uuid,text,text)'::regprocedure))=0
  and position('imported_priority_value(r.source_dataset,r.source_payload' in pg_get_functiondef('public.review_analysis(uuid,text,uuid,text[],uuid,text,text)'::regprocedure))=0 then raise exception 'Priority not connected to saved results';end if;
end $$;
