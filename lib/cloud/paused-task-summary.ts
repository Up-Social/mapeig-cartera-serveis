import type {SupabaseClient} from '@supabase/supabase-js';

export type PausedTask = {
  id: string; executor: string; task_type: string; run_id: string | null;
  pipeline_job_id: string | null; source_record_id: string | null;
  status: string; execution_state: string; failure_kind: string | null;
  created_at: string; completed_at: string | null; lease_until: string | null;
};
export type TaskJob = {
  id: string; run_id: string; source_record_id: string; status: string;
  preparation_status: string; enrichment_status: string; error_kind: string | null;
  error_message: string | null; enrichment_error: string | null;
};
export type PauseEvidence = {
  tasks: PausedTask[]; jobs: TaskJob[]; validResultJobs: string[];
  uncertainTaskIds: string[]; uncertainJobIds: string[]; reservedTaskIds: string[];
  runs: {id: string; batch_number: number}[];
};
export type PauseReason = 'scope_unverified' | 'provider_uncertain' | 'cost_unsettled' | 'no_completed_successor' | 'result_unverified';
export type PauseEntry = {
  taskId: string; runId: string | null; jobId: string | null; batchNumber: number | null;
  createdAt: string; originalState: string; originalFailure: string | null;
  resolution: {taskId: string; completedAt: string} | null; reason: PauseReason | null;
};
export type PausedTaskSummary = {needsReview: PauseEntry[]; historicalResolved: PauseEntry[]};

// PostgreSQL timestamps retain microseconds; Date.parse alone loses their ordering.
function timestamp(value: string): number {
  return Date.parse(value) * 1000 + Number((value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6));
}
const terminalJobs = new Set(['needs_review', 'approved', 'corrected', 'rejected', 'insufficient_evidence']);

/** A display projection only: never changes task state, checkpoints, billing or resumability. */
export function summarizePausedTasks(evidence: PauseEvidence): PausedTaskSummary {
  const tasks = [...evidence.tasks].sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at) || b.id.localeCompare(a.id));
  const jobs = new Map(evidence.jobs.map(job => [job.id, job]));
  const runs = new Map(evidence.runs.map(run => [run.id, run.batch_number]));
  const validResults = new Set(evidence.validResultJobs);
  const uncertainTasks = new Set(evidence.uncertainTaskIds);
  const uncertainJobs = new Set(evidence.uncertainJobIds);
  const reservedTasks = new Set(evidence.reservedTaskIds);
  const summary: PausedTaskSummary = {needsReview: [], historicalResolved: []};
  for (const task of tasks.filter(task => task.executor === 'vercel_workflow' && task.execution_state === 'paused')) {
    const entry: PauseEntry = {
      taskId: task.id, runId: task.run_id, jobId: task.pipeline_job_id,
      batchNumber: task.run_id ? runs.get(task.run_id) ?? null : null,
      createdAt: task.created_at, originalState: task.execution_state, originalFailure: task.failure_kind,
      resolution: null, reason: null,
    };
    const job = task.pipeline_job_id ? jobs.get(task.pipeline_job_id) : undefined;
    // Run-wide or record-only attempts need a separate coverage proof. Never infer
    // that a newer operation on the same record completed this original work.
    const scope = job && task.run_id === job.run_id && (!task.source_record_id || task.source_record_id === job.source_record_id);
    const related = job ? tasks.filter(candidate => candidate.pipeline_job_id === job.id) : [task];
    const latest = related.find(candidate => candidate.executor === task.executor && candidate.task_type === task.task_type &&
      candidate.run_id === task.run_id && (!candidate.source_record_id || candidate.source_record_id === job?.source_record_id));
    if (!scope) entry.reason = 'scope_unverified';
    else if (uncertainJobs.has(job.id) || related.some(candidate => candidate.failure_kind === 'provider_unknown' || uncertainTasks.has(candidate.id))) entry.reason = 'provider_uncertain';
    else if (related.some(candidate => reservedTasks.has(candidate.id))) entry.reason = 'cost_unsettled';
    else if (!latest || latest.id === task.id || latest.status !== 'completed' || latest.execution_state !== 'completed' ||
      latest.failure_kind || latest.lease_until || !latest.completed_at ||
      !Number.isFinite(timestamp(latest.created_at)) || !Number.isFinite(timestamp(task.created_at)) ||
      !(timestamp(latest.completed_at) >= timestamp(latest.created_at))) entry.reason = 'no_completed_successor';
    else {
      const clean = job.status !== 'error' && !job.error_kind && !job.error_message &&
        job.preparation_status !== 'error' && job.enrichment_status !== 'error' && !job.enrichment_error;
      const completed = clean && (
        (['process_run', 'match_run'].includes(task.task_type) && terminalJobs.has(job.status) && validResults.has(job.id)) ||
        (task.task_type === 'prepare_run' && job.preparation_status === 'ready') ||
        (task.task_type === 'enrich_record' && job.enrichment_status === 'completed' && !job.enrichment_error)
      );
      if (!completed) entry.reason = 'result_unverified';
      else entry.resolution = {taskId: latest.id, completedAt: latest.completed_at};
    }
    (entry.resolution ? summary.historicalResolved : summary.needsReview).push(entry);
  }
  return summary;
}

type Page<T> = {data: T[] | null; error: unknown};
async function readAll<T>(read: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  // Read until an empty page, including when a server caps pages below our size.
  for (;;) {
    const page = await read(rows.length, rows.length + 499);
    if (page.error || !page.data) throw new Error('PAUSED_TASK_SUMMARY_UNAVAILABLE');
    if (!page.data.length) return rows;
    rows.push(...page.data);
  }
}
async function readGroups<T>(ids: string[], read: (ids: string[], from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 50) {
    const group = ids.slice(offset, offset + 50);
    rows.push(...await readAll((from, to) => read(group, from, to)));
  }
  return rows;
}

export async function loadPausedTaskSummary(db: SupabaseClient): Promise<PausedTaskSummary> {
  const tasks = await readAll<PausedTask>((from, to) => db.from('worker_tasks')
    .select('id,executor,task_type,run_id,pipeline_job_id,source_record_id,status,execution_state,failure_kind,created_at,completed_at,lease_until')
    .eq('executor', 'vercel_workflow').order('created_at', {ascending: false}).order('id', {ascending: false}).range(from, to));
  const paused = tasks.filter(task => task.execution_state === 'paused');
  if (!paused.length) return {needsReview: [], historicalResolved: []};
  const jobIds = [...new Set(paused.flatMap(task => task.pipeline_job_id ? [task.pipeline_job_id] : []))];
  const runIds = [...new Set(paused.flatMap(task => task.run_id ? [task.run_id] : []))];
  const taskIds = tasks.filter(task => task.execution_state === 'paused' || (task.pipeline_job_id && jobIds.includes(task.pipeline_job_id))).map(task => task.id);
  const [jobs, results, invalidCandidates, checkpoints, reservations, calls, runs] = await Promise.all([
    readGroups<TaskJob>(jobIds, (ids, from, to) => db.from('pipeline_jobs').select('id,run_id,source_record_id,status,preparation_status,enrichment_status,error_kind,error_message,enrichment_error').in('id', ids).order('id').range(from, to)),
    readGroups<{pipeline_job_id: string}>(jobIds, (ids, from, to) => db.from('analysis_results').select('pipeline_job_id').in('pipeline_job_id', ids).eq('reliability_status', 'valid').is('invalidated_at', null).order('id').range(from, to)),
    readGroups<{pipeline_job_id: string}>(jobIds, (ids, from, to) => db.from('matching_candidates').select('pipeline_job_id').in('pipeline_job_id', ids).lte('score', 0).order('id').range(from, to)),
    readGroups<{task_id: string}>(taskIds, (ids, from, to) => db.from('cloud_checkpoints').select('task_id').in('task_id', ids).or('value->>state.in.(sending,unknown),value->>unknown.eq.true').order('task_id').order('item_key').range(from, to)),
    readGroups<{task_id: string}>(taskIds, (ids, from, to) => db.from('cloud_budget_reservations').select('task_id').in('task_id', ids).is('actual_usd', null).order('task_id').order('item_key').range(from, to)),
    readGroups<{pipeline_job_id: string}>(jobIds, (ids, from, to) => db.from('provider_calls').select('pipeline_job_id').in('pipeline_job_id', ids).in('state', ['sending', 'unknown']).order('id').range(from, to)),
    readGroups<{id: string; batch_number: number}>(runIds, (ids, from, to) => db.from('pipeline_runs').select('id,batch_number').in('id', ids).order('id').range(from, to)),
  ]);
  const invalidJobs = new Set(invalidCandidates.map(row => row.pipeline_job_id));
  return summarizePausedTasks({tasks, jobs, runs,
    validResultJobs: results.map(row => row.pipeline_job_id).filter(id => !invalidJobs.has(id)),
    uncertainTaskIds: checkpoints.map(row => row.task_id), reservedTaskIds: reservations.map(row => row.task_id),
    uncertainJobIds: calls.map(row => row.pipeline_job_id),
  });
}
