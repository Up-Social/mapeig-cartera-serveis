update public.service_provisions as provision
set
  regulatory_basis_url = coalesce(
    (
      select document.url
      from public.source_documents as document
      where document.source_record_id = provision.source_record_id
        and (
          document.document_type = 'regulatory_basis'
          or exists (
            select 1
            from unnest(document.source_fields) as source_field
            where lower(source_field) ~ 'bases? regulador(a|as|es)?'
          )
        )
      order by (document.document_type = 'regulatory_basis') desc, document.discovered_at
      limit 1
    ),
    nullif(provision.call_url, '')
  ),
  updated_at = now()
where nullif(provision.regulatory_basis_url, '') is null;
