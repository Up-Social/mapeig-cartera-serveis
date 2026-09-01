alter table public.excel_exports
  add column if not exists pipeline_run_id uuid references public.pipeline_runs(id) on delete set null;

create index if not exists excel_exports_pipeline_run_idx on public.excel_exports(pipeline_run_id, created_at desc);

comment on column public.excel_exports.pipeline_run_id is
  'Lot concret del qual s''han exportat les provisions; nul per a exportacions globals antigues.';
