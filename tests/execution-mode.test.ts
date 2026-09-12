import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executionMode} from '../lib/pipeline/execution-mode';
test('local unchanged and preview cannot execute real tasks',()=>{
 assert.equal(executionMode({NODE_ENV:'development'}),'local');
 assert.equal(executionMode({VERCEL_ENV:'preview',WORKER_EXECUTION_MODE:'vercel_workflow'}),'disabled');
 assert.equal(executionMode({VERCEL_ENV:'production',WORKER_EXECUTION_MODE:'vercel_workflow'}),'vercel_workflow');
 assert.equal(executionMode({NODE_ENV:'production'}),'queue');
});
