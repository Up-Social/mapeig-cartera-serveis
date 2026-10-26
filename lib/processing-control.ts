import type { SupabaseClient } from '@supabase/supabase-js';
import { executionMode } from './pipeline/execution-mode';
import { assertTestEnvironment } from './test-environment';

export type ProcessingSetting = {
  enabled: boolean;
  reason: string | null;
  updatedAt: string | null;
};

export class ProcessingDisabledError extends Error {
  readonly code = 'PROCESSING_DISABLED';
  constructor() {
    super('Processament no disponible: està aturat preventivament. Consulta Administració.');
    this.name = 'ProcessingDisabledError';
  }
}

/** Child processes emit this stable marker; never infer a document failure from a pause. */
export function isProcessingPaused(error: unknown): boolean {
  if (error instanceof ProcessingDisabledError) return true;
  if (!error || typeof error !== 'object') return false;
  const value = error as {code?:unknown;message?:unknown;stderr?:unknown};
  return value.code === 'PROCESSING_DISABLED' ||
    [value.message, value.stderr].some(text => typeof text === 'string' && /PROCESSING_DISABLED|PROCESSING_PAUSE_UNAVAILABLE/.test(text));
}

export const PROCESSING_PAUSE_EXIT_CODE = 75;

/** Operational pause only: no source, result, document, checkpoint or journal rewrites. */
export async function pauseLocalProcessing(db: SupabaseClient, target: {runId?:string|null;taskId?:string;jobId?:string|null}) {
  let runId=target.runId;
  if (!runId && target.jobId) {
    const job=await db.from('pipeline_jobs').select('run_id').eq('id',target.jobId).single();
    if(job.error)throw new Error('PROCESSING_PAUSE_UNAVAILABLE');
    runId=job.data.run_id;
  }
  if (runId) {
    const result=await db.from('pipeline_runs').update({status:'paused',pause_kind:'processing_disabled',pause_reason:'Processament aturat preventivament. Cal reprendre explícitament el lot.'})
      .eq('id',runId).in('status',['queued','preparing','ready','enriching','matching','paused']);
    if(result.error)throw new Error('PROCESSING_PAUSE_UNAVAILABLE');
  }
  if (target.taskId) {
    const result=await db.from('worker_tasks').update({status:'failed',execution_state:'paused',failure_kind:'processing_disabled',
      error_message:'Processament aturat preventivament.',completed_at:null,claimed_by:null,claimed_at:null})
      .eq('id',target.taskId).eq('executor','local').eq('status','running');
    if(result.error)throw new Error('PROCESSING_PAUSE_UNAVAILABLE');
  }
}

/** No cache: every new unit must see the shared operational switch. */
export async function getProcessingSetting(db: SupabaseClient): Promise<ProcessingSetting> {
  try {
    const { data, error } = await db.from('app_settings')
      .select('enabled,reason,updated_at').eq('key', 'processing_enabled').maybeSingle();
    if (error) return { enabled: false, reason: 'state_unavailable', updatedAt: null };
    if (!data) return { enabled: false, reason: 'setting_missing', updatedAt: null };
    return { enabled: data.enabled === true, reason: data.reason ?? null, updatedAt: data.updated_at ?? null };
  } catch {
    return { enabled: false, reason: 'state_unavailable', updatedAt: null };
  }
}

export async function assertProcessingEnabled(db: SupabaseClient): Promise<void> {
  if (executionMode() === 'disabled') {
    // The existing fixture runner intentionally disables real executors; mocks are
    // allowed only on its independently named local DB and without provider secrets.
    if (process.env.PIPELINE_PROVIDER === 'mock') assertTestEnvironment(process.env);
    else throw new ProcessingDisabledError();
  }
  if (!(await getProcessingSetting(db)).enabled) throw new ProcessingDisabledError();
}

/** Enabling uses the state read before inventory/probe, so a concurrent incident wins. */
export async function setProcessingEnabled(
  db: SupabaseClient, enabled: boolean, reason: string | null, expectedUpdatedAt?: string | null,
): Promise<ProcessingSetting> {
  if (enabled && !expectedUpdatedAt) throw new Error('PROCESSING_STATE_CHANGED');
  const value = { enabled, reason: reason?.slice(0, 240) ?? null, updated_at: new Date().toISOString() };
  const query = enabled
    ? db.from('app_settings').update(value).eq('key', 'processing_enabled').eq('updated_at', expectedUpdatedAt!)
    : db.from('app_settings').upsert({ key: 'processing_enabled', ...value }, { onConflict: 'key' });
  const { data, error } = await query.select('enabled,reason,updated_at').single();
  if (error || !data) throw new Error(enabled ? 'PROCESSING_STATE_CHANGED' : 'PROCESSING_CONTROL_UNAVAILABLE');
  return { enabled: data.enabled === true, reason: data.reason, updatedAt: data.updated_at };
}

export function disableProcessing(db: SupabaseClient, reason: string) {
  return setProcessingEnabled(db, false, reason);
}
