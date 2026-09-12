import {test} from 'node:test';import assert from 'node:assert/strict';import {executionStatus} from '../lib/cloud/execution-status';
test('queued, stale, quota and uncertain responses remain distinguishable',()=>{
 const task={execution_state:'pending',lease_until:null,last_progress_at:null,failure_kind:null};
 assert.equal(executionStatus(task).label,'Pendent d’inici');
 assert.equal(executionStatus({...task,execution_state:'running',lease_until:'2000-01-01'}).state,'interrupted');
 assert.equal(executionStatus({...task,execution_state:'paused',failure_kind:'vercel_quota'}).label,'Pausat per quota');
 assert.equal(executionStatus({...task,execution_state:'paused',failure_kind:'provider_unknown'}).recoverable,false);
});
