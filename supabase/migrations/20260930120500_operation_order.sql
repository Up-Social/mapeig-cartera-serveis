-- Several jobs can be created in one transaction; now() would tie their dates
-- and make the random UUID decide which job is current.
alter table public.pipeline_jobs alter column created_at set default clock_timestamp();
alter table public.worker_tasks alter column created_at set default clock_timestamp();
