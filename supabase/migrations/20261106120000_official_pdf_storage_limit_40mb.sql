-- Scanned official PDFs can exceed 16 MiB (a 2025 conveni is 28 MB), so the
-- download cap (MAX_PDF_BYTES) is now 40 MiB. The private archive must accept
-- every PDF the application can download, or the record fails after reading it.
do $$
declare current_limit bigint;
begin
 select file_size_limit into current_limit from storage.buckets where id='cloud-documents';
 if not found then raise exception 'Missing cloud-documents bucket'; end if;
 if current_limit is null or current_limit not in (16777216,41943040) then
  raise exception 'Unexpected cloud-documents file size limit: %',current_limit;
 end if;
 update storage.buckets set file_size_limit=41943040 where id='cloud-documents';
end $$;
