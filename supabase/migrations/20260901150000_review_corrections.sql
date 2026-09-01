grant delete on public.service_provisions to service_role;

comment on table public.review_decisions is
  'Historial immutable de decisions humanes; la decisió més recent és la vigent.';
