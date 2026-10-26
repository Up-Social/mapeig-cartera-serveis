import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadPausedTaskSummary, summarizePausedTasks, type PauseEvidence, type PausedTask} from '../lib/cloud/paused-task-summary';
import {PausedTasks} from '../app/admin/paused-tasks';

function fixture(): PauseEvidence {
  const original: PausedTask = {id:'a', executor:'vercel_workflow', task_type:'process_run', run_id:'run', pipeline_job_id:'job', source_record_id:null,
    status:'failed', execution_state:'paused', failure_kind:'vercel_quota', created_at:'2026-09-23T13:39:04.427106Z', completed_at:null, lease_until:null};
  return {
    tasks:[original, {...original, id:'b', status:'completed', execution_state:'completed', failure_kind:null, created_at:'2026-09-29T13:39:04Z', completed_at:'2026-09-29T13:40:04Z'}],
    jobs:[{id:'job', run_id:'run', source_record_id:'record', status:'needs_review', preparation_status:'ready', enrichment_status:'completed', error_kind:null, error_message:null, enrichment_error:null}],
    validResultJobs:['job'], uncertainTaskIds:[], uncertainJobIds:[], reservedTaskIds:[], runs:[{id:'run',batch_number:58}],
  };
}
test('a later completion resolves only the derived count, preserving original state and human review', () => {
  const input=fixture(); const before=structuredClone(input);
  const summary=summarizePausedTasks(input);
  assert.equal(summary.needsReview.length,0);
  assert.equal(summary.historicalResolved.length,1);
  assert.deepEqual(summary.historicalResolved[0].resolution,{taskId:'b',completedAt:'2026-09-29T13:40:04Z'});
  assert.equal(summary.historicalResolved[0].originalState,'paused');
  assert.equal(summary.historicalResolved[0].originalFailure,'vercel_quota');
  assert.deepEqual(input,before);
  assert.equal(input.jobs[0].status,'needs_review');
});
for (const [label, change] of Object.entries<(input: PauseEvidence) => void>({
  'another phase': input=>{input.tasks[1].task_type='prepare_run';},
  'another job on the same record': input=>{input.tasks[1].pipeline_job_id='another-job';},
  'another run': input=>{input.tasks[1].run_id='another-run';},
  'another executor': input=>{input.tasks[1].executor='local';},
  'contradictory record': input=>{input.tasks[1].source_record_id='another-record';},
  'only an older completion': input=>{input.tasks[1].created_at='2026-09-22T13:39:04Z';},
  'unfinished latest attempt': input=>{input.tasks.push({...input.tasks[1],id:'c',created_at:'2026-10-01T00:00:00Z',status:'running',execution_state:'running'});},
  'completion without finished execution': input=>{input.tasks[1].execution_state='pending';},
  'completion with failed status': input=>{input.tasks[1].status='failed';},
  'completion with a lease': input=>{input.tasks[1].lease_until='2026-10-01T00:00:00Z';},
  'completion without a date': input=>{input.tasks[1].completed_at=null;},
  'completion with an invalid date': input=>{input.tasks[1].completed_at='invalid';},
  'completion before creation': input=>{input.tasks[1].completed_at='2026-09-01T00:00:00Z';},
})) {
  test(`${label} cannot hide the original pause`,()=>{
    const input=fixture();change(input);
    assert.equal(summarizePausedTasks(input).needsReview[0].reason,'no_completed_successor');
  });
}
for (const field of ['pipeline_job_id','run_id'] as const) {
  test(`missing ${field} never infers coverage from another task`,()=>{
    const input=fixture();input.tasks[0][field]=null;
    assert.equal(summarizePausedTasks(input).needsReview[0].reason,'scope_unverified');
  });
}
test('a skipped errored job or absent/invalidated result is not completed work',()=>{
  for (const change of [
    (input:PauseEvidence)=>{input.jobs[0].status='error';},
    (input:PauseEvidence)=>{input.jobs[0].status='matching';},
    (input:PauseEvidence)=>{input.jobs[0].error_kind='document';},
    (input:PauseEvidence)=>{input.jobs[0].preparation_status='error';},
    (input:PauseEvidence)=>{input.jobs[0].enrichment_status='error';},
    (input:PauseEvidence)=>{input.jobs[0].enrichment_error='synthetic-phase-failure';},
    (input:PauseEvidence)=>{input.validResultJobs=[];},
    (input:PauseEvidence)=>{input.tasks.forEach(task=>task.task_type='unknown-phase');},
  ]) {
    const input=fixture();change(input);
    assert.equal(summarizePausedTasks(input).needsReview[0].reason,'result_unverified');
  }
});
test('uncertain provider calls and outstanding reservations remain visible even with later results',()=>{
  for (const taskId of ['a','b']) {
    for (const field of ['uncertainTaskIds','reservedTaskIds'] as const) {
      const input=fixture();input[field]=[taskId];
      assert.equal(summarizePausedTasks(input).needsReview[0].reason,field==='reservedTaskIds'?'cost_unsettled':'provider_uncertain');
    }
  }
  for (const change of [
    (input:PauseEvidence)=>{input.uncertainJobIds=['job'];},
    (input:PauseEvidence)=>{input.tasks[0].failure_kind='provider_unknown';},
  ]) {
    const input=fixture();change(input);
    assert.equal(summarizePausedTasks(input).needsReview[0].reason,'provider_uncertain');
  }
});
test('phase-specific preparation and enrichment require their own completion evidence',()=>{
  for (const [type,field] of [['prepare_run','preparation_status'],['enrich_record','enrichment_status']] as const) {
    const input=fixture();input.tasks.forEach(task=>task.task_type=type);input.validResultJobs=[];
    assert.equal(summarizePausedTasks(input).historicalResolved.length,1);
    input.jobs[0][field]='pending';
    assert.equal(summarizePausedTasks(input).needsReview[0].reason,'result_unverified');
  }
});
test('timestamp microseconds and ID ties select the latest attempt regardless of input order',()=>{
  const input=fixture();input.tasks[1].id='0';
  input.tasks[1].created_at='2026-09-23T13:39:04.427107Z';
  assert.equal(summarizePausedTasks(input).historicalResolved.length,1);
  input.tasks[1].created_at=input.tasks[0].created_at;
  assert.equal(summarizePausedTasks(input).needsReview.length,1);
  input.tasks[1].id='z';input.tasks.reverse();
  assert.equal(summarizePausedTasks(input).historicalResolved.length,1);
});

// Run the installed Supabase client with a read-only synthetic HTTP transport.
// A one-row server cap exercises pagination independently of our chosen page size.
function transport(options: {failTable?:string; uncertain?:boolean; reserved?:boolean; invalidCandidate?:boolean; invalidResult?:boolean}={}) {
  const input=fixture();const requests:URL[]=[];
  const rows:Record<string,unknown[]>={
    worker_tasks:input.tasks, pipeline_jobs:input.jobs, pipeline_runs:input.runs,
    analysis_results:options.invalidResult?[]:[{pipeline_job_id:'job'}],
    matching_candidates:options.invalidCandidate?[{pipeline_job_id:'job'}]:[],
    cloud_checkpoints:options.uncertain?[{task_id:'a'}]:[],
    cloud_budget_reservations:options.reserved?[{task_id:'a'}]:[],provider_calls:[],
  };
  const fetch:typeof globalThis.fetch=async (url,init)=>{
    assert.equal(init?.method,'GET','The summary must never write');
    const request=new URL(String(url));requests.push(request);
    const table=request.pathname.split('/').at(-1)!;
    assert.ok(table in rows);
    const offset=Number(request.searchParams.get('offset')??0);
    if (table===options.failTable && (table!=='worker_tasks'||offset>0)) return Response.json({message:'synthetic sensitive error'},{status:400});
    return Response.json(rows[table].slice(offset,offset+1));
  };
  return {db:createClient('http://fixture.invalid','synthetic-key',{global:{fetch},auth:{persistSession:false,autoRefreshToken:false}}), requests};
}
test('loader reads every page and projects only metadata with provider/cost safeguards',async()=>{
  const {db,requests}=transport();
  assert.equal((await loadPausedTaskSummary(db)).historicalResolved.length,1);
  const query=(table:string)=>requests.find(url=>url.pathname.endsWith(`/${table}`))!.searchParams;
  assert.equal(query('worker_tasks').get('order'),'created_at.desc,id.desc');
  assert.equal(requests.filter(url=>url.pathname.endsWith('/worker_tasks')).length,3);
  assert.equal(query('analysis_results').get('reliability_status'),'eq.valid');
  assert.equal(query('analysis_results').get('invalidated_at'),'is.null');
  assert.equal(query('matching_candidates').get('score'),'lte.0');
  assert.match(query('cloud_checkpoints').get('or')!,/sending,unknown/);
  assert.match(query('cloud_checkpoints').get('or')!,/unknown.eq.true/);
  assert.equal(query('cloud_checkpoints').get('select'),'task_id');
  assert.equal(query('cloud_budget_reservations').get('actual_usd'),'is.null');
  assert.equal(query('provider_calls').get('state'),'in.(sending,unknown)');
});
for (const failTable of ['worker_tasks','pipeline_jobs','analysis_results','matching_candidates','cloud_checkpoints','cloud_budget_reservations','provider_calls','pipeline_runs']) {
  test(`a partial/failed ${failTable} read never produces a reassuring count`,async()=>{
    const {db}=transport({failTable});
    await assert.rejects(loadPausedTaskSummary(db),/^Error: PAUSED_TASK_SUMMARY_UNAVAILABLE$/);
  });
}
test('loader keeps uncertain calls, unsettled costs and invalid results in review',async()=>{
  for (const options of [{uncertain:true},{reserved:true},{invalidCandidate:true},{invalidResult:true}]) {
    assert.equal((await loadPausedTaskSummary(transport(options).db)).needsReview.length,1);
  }
});
test('administration distinguishes technical completion from human review and unavailable counts',()=>{
  const html=renderToStaticMarkup(createElement(PausedTasks,{summary:summarizePausedTasks(fixture())}));
  assert.match(html,/data-testid="paused-needs-review">0</);
  assert.match(html,/data-testid="paused-historical-resolved">1</);
  assert.match(html,/revisió humana/);
  assert.match(html,/Estat original conservat: paused/);
  assert.doesNotMatch(html,/<button/);
  const unavailable=renderToStaticMarkup(createElement(PausedTasks,{summary:null}));
  assert.match(unavailable,/No s’ha pogut verificar el recompte/);
  assert.doesNotMatch(unavailable,/data-testid="paused-needs-review"/);
});
