alter table public.service_provisions
  add column if not exists approved_at timestamptz;

update public.service_provisions provision
set approved_at = coalesce(
  (
    select max(review.created_at)
    from public.review_decisions review
    where review.source_record_id = provision.source_record_id
      and review.decision in ('approved', 'corrected')
  ),
  provision.updated_at,
  provision.created_at
)
where provision.approved_at is null;

alter table public.service_provisions
  alter column approved_at set default now(),
  alter column approved_at set not null;

create index if not exists service_provisions_approved_at_idx
  on public.service_provisions(approved_at desc);

comment on column public.service_provisions.approved_at is
  'Moment de la darrera aprovació o correcció humana vigent, usat per ordenar la vista d’aprovats.';
