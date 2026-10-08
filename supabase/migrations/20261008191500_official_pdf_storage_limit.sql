-- A ten-page official convenio PDF is 12.2 MB. Keep the archive private while
-- allowing PDFs within the application's 16 MiB download limit.
do $$
declare current_limit bigint;
begin
 select file_size_limit into current_limit from storage.buckets where id='cloud-documents';
 if not found then raise exception 'Missing cloud-documents bucket'; end if;
 if current_limit is null or current_limit not in (10485760,16777216) then
  raise exception 'Unexpected cloud-documents file size limit: %',current_limit;
 end if;
 update storage.buckets set file_size_limit=16777216 where id='cloud-documents';
end $$;
