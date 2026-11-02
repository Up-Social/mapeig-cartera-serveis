import test from 'node:test';
import assert from 'node:assert/strict';
import {executionStatus} from '../lib/cloud/execution-status';
import {publicErrorMessage} from '../lib/public-error';
import {rpc} from '../lib/cloud/context';
import {CloudFailure} from '../lib/cloud/errors';

test('a reconciliation pause is not offered for resume and has a clear label',()=>{
 const status=executionStatus({execution_state:'paused',failure_kind:'provider_reconciliation',lease_until:null,last_progress_at:null});
 assert.equal(status.recoverable,false);assert.match(status.label,/conciliar/i);
 assert.match(publicErrorMessage(new CloudFailure('provider_reconciliation')),/conciliació/);
 assert.match(publicErrorMessage(new Error('PROVIDER_RECONCILIATION_REQUIRED')),/conciliació/);
 assert.match(publicErrorMessage(new Error('RECORD_OPERATION_BUSY')),/modificant/);
});
test('SQL rejection maps to the reconciliation message without provider data',async()=>{
 const db={rpc:async()=>({data:null,error:{code:'P0001',message:'PROVIDER_RECONCILIATION_REQUIRED'}})};
 await assert.rejects(rpc(db as never,'cloud_resume',{}),error=>error instanceof CloudFailure&&error.kind==='provider_reconciliation');
});
