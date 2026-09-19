export const TEST_PROJECT = 'cartera-workflow-test';
export const TEST_API = 'http://127.0.0.1:55421';
export function assertTestEnvironment(env: Record<string, string | undefined>) {
  if (env.NEXT_PUBLIC_SUPABASE_URL !== TEST_API || env.WORKFLOW_TEST_PROJECT !== TEST_PROJECT || env.PIPELINE_PROVIDER !== 'mock') {
    throw new Error('Isolated workflow test environment required');
  }
  if (env.OPENAI_API_KEY || env.VERCEL_TOKEN || env.SUPABASE_ACCESS_TOKEN) throw new Error('Real provider credentials forbidden in tests');
}
