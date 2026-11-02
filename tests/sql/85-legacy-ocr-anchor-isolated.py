#!/usr/bin/env python3
"""Verify the OCR migration against preserved function formatting in isolated PostgreSQL."""
from pathlib import Path
import subprocess
import time
import uuid

root = Path(__file__).resolve().parents[2]
migration = (root / 'supabase/migrations/20261028232000_legacy_ocr_recovery_marker.sql').read_text()
concert_migration = (root / 'supabase/migrations/20261028212000_concert_null_identity_guard.sql').read_text()
name = 'mapeig-ocr-anchor-' + uuid.uuid4().hex[:12]

def command(args, **kwargs):
    return subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)

def sql(query, success=True):
    result = command(['docker', 'exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], input=query)
    if (result.returncode == 0) != success:
        raise AssertionError(f'Unexpected PostgreSQL outcome: {result.stdout}\n{result.stderr}')
    return result.stdout.strip(), result.stderr

def make_function(update, comment=''):
    return f'''create or replace function public.begin_record_operation(p_record uuid,p_operation text,p_executor text)
returns jsonb language plpgsql as $fn$
declare task uuid := '00000000-0000-0000-0000-000000000001';
begin
{comment}
{update}
where id=p_record;
return '{{}}'::jsonb;
end $fn$;'''

base = "update source_records\n" + (' ' * 492) + "set processing_status=case when p_operation='match' then 'processing' else 'ready' end"
try:
    result = command(['docker', 'run', '-d', '--pull=never', '--network=none', '--name', name, '-e', 'POSTGRES_PASSWORD=isolated-test-only', 'postgres:16-alpine'])
    if result.returncode:
        raise RuntimeError(result.stderr)
    for _ in range(100):
        if command(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).returncode == 0:
            break
        time.sleep(.2)
    else:
        raise RuntimeError('PostgreSQL did not start')
    sql('''create table source_records(id uuid primary key, processing_status text);
create table worker_tasks(id uuid primary key,source_record_id uuid,run_id uuid);
create table pipeline_jobs(run_id uuid,source_record_id uuid);
create table source_documents(id uuid,source_record_id uuid);
create table cloud_checkpoints(task_id uuid,item_key text,value jsonb,primary key(task_id,item_key));
insert into source_records values ('00000000-0000-0000-0000-000000000010','ready');
insert into worker_tasks values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010',null);
insert into cloud_checkpoints values ('00000000-0000-0000-0000-000000000002','ocr:legacy','{}');
insert into source_documents values ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010');''')
    sql(make_function(base))
    before, _ = sql("select pg_get_functiondef('public.begin_record_operation(uuid,text,text)'::regprocedure)")
    sql(migration)
    after, _ = sql("select pg_get_functiondef('public.begin_record_operation(uuid,text,text)'::regprocedure)")
    # Every original byte still appears after removing the new block.
    marker_start = after.index("if p_executor='vercel_workflow' and exists(")
    marker_end = after.index('update source_records', marker_start)
    assert after[:marker_start] + after[marker_end:] == before
    out, _ = sql("select public.begin_record_operation('00000000-0000-0000-0000-000000000010','match','vercel_workflow'); select count(*) from cloud_checkpoints where item_key='legacy-ocr-pending:00000000-0000-0000-0000-000000000003';")
    assert out.splitlines()[-1] == '1', out
    for label, update, comment in [
        ('absent', base.replace("p_operation='match'", "p_operation='other'"), ''),
        ('ambiguous', base, "-- update source_records set processing_status=case when p_operation='match'"),
    ]:
        sql(make_function(update, comment))
        original, _ = sql("select pg_get_functiondef('public.begin_record_operation(uuid,text,text)'::regprocedure)")
        _, error = sql(migration, success=False)
        assert 'expected one update anchor' in error, error
        unchanged, _ = sql("select pg_get_functiondef('public.begin_record_operation(uuid,text,text)'::regprocedure)")
        assert original == unchanged, label
    sql('''create table concert_fixture(provider_nif text,effective_start date,effective_end date);
create function public.cloud_stage_concert_annex_line(uuid,uuid,bigint,uuid,uuid,p_line jsonb)
returns text language plpgsql as $fn$
declare existing record;
begin
  if false or p_line->>'nif' !~ '^[A-Z][0-9]{7}[0-9A-Z]$' then return 'invalid'; end if;
  select * into existing from concert_fixture limit 1;
  if found then
    if existing.provider_nif<>p_line->>'nif' then return 'conflict'; end if;
    return 'retry';
  end if;
  insert into concert_fixture(provider_nif,effective_start,effective_end)
  values (p_line->>'nif',(p_line->>'effective_start')::date,(p_line->>'effective_end')::date);
  return 'inserted';
end $fn$;''')
    before, _ = sql("select pg_get_functiondef('public.cloud_stage_concert_annex_line(uuid,uuid,bigint,uuid,uuid,jsonb)'::regprocedure)")
    sql(concert_migration)
    after, _ = sql("select pg_get_functiondef('public.cloud_stage_concert_annex_line(uuid,uuid,bigint,uuid,uuid,jsonb)'::regprocedure)")
    expected = before.replace("or p_line->>'nif' !~ '^[A-Z][0-9]{7}[0-9A-Z]$'", "or (p_line->>'nif' is not null and p_line->>'nif' !~ '^[A-Z][0-9]{7}[0-9A-Z]$')").replace("existing.provider_nif<>p_line->>'nif'", "existing.provider_nif is distinct from p_line->>'nif'")
    assert after == expected, 'Concert migration changed unrelated production-shaped function text'
    out, _ = sql('''select public.cloud_stage_concert_annex_line(null,null,null,null,null,'{"effective_start":"2026-01-01","effective_end":"2026-12-31"}');
select effective_start||','||effective_end from concert_fixture;
select public.cloud_stage_concert_annex_line(null,null,null,null,null,'{"nif":"A12345678"}');''')
    assert out.splitlines() == ['inserted', '2026-01-01,2026-12-31', 'conflict'], out
    print('PASS: 492 whitespace characters; original definition preserved; marker created; missing and duplicate anchors fail closed.')
    print('PASS: concert fixture preserves effective date columns and changes only identity guards; NULL retry conflict checked.')
finally:
    command(['docker', 'rm', '-f', name])
