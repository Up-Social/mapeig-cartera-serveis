import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTestEnvironment, TEST_API, TEST_PROJECT} from '../lib/test-environment';
const env = {NEXT_PUBLIC_SUPABASE_URL: TEST_API, WORKFLOW_TEST_PROJECT: TEST_PROJECT, PIPELINE_PROVIDER: 'mock'};
test('isolated test guard refuses remote targets, wrong identities and real providers', () => {
  assert.doesNotThrow(() => assertTestEnvironment(env));
  for (const patch of [{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co'}, {WORKFLOW_TEST_PROJECT:'production'}, {PIPELINE_PROVIDER:'openai'}, {OPENAI_API_KEY:'forbidden'}]) assert.throws(() => assertTestEnvironment({...env,...patch}));
});
