export type ExecutionMode = 'local' | 'queue' | 'vercel_workflow' | 'disabled';
export function executionMode(env: Record<string, string | undefined> = process.env): ExecutionMode {
  if (env.VERCEL_ENV === 'preview') return 'disabled';
  if (env.WORKER_EXECUTION_MODE === 'vercel_workflow') {
    return env.VERCEL_ENV === 'production' ? 'vercel_workflow' : 'disabled';
  }
  return env.NODE_ENV === 'production' || env.VERCEL === '1' || env.WORKER_EXECUTION_MODE === 'queue' ? 'queue' : 'local';
}
