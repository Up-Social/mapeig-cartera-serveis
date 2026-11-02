-- A call is a procedural antecedent, not an economic change or an original
-- financial unit. Preserve every existing kind and add only this explicit type.
alter table public.concert_record_links drop constraint concert_record_links_link_kind_check;
alter table public.concert_record_links add constraint concert_record_links_link_kind_check
 check(link_kind in ('amendment','renewal','modification','termination','cession','appeal','validation','call','other'));
