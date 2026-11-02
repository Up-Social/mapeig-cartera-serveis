import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesDiagnosticReconciliation,parseDiagnosticReconciliation,parseDiagnosticReconciliationStatus} from '../lib/concerts/diagnostic-reconciliation';
const row={unit_id:'one',page:7,net_cents:10000,gross_cents:11000,reses:'S12345',code:'1.2.3'};
const value={revision:1,maximum_net_cents:10000,calculated_net_cents:10000,calculated_gross_cents:11000,unit_proof:[row]};
test('accepts only complete and internally consistent documentary receipts',()=>{
 assert.deepEqual(parseDiagnosticReconciliation(value),value);
 for(const invalid of [null,{...value,calculated_gross_cents:12000},{...value,maximum_net_cents:1},{...value,unit_proof:[]},{...value,unit_proof:[row,row]},{...value,unit_proof:[{...row,net_cents:Number.MAX_SAFE_INTEGER+1}]}])assert.equal(parseDiagnosticReconciliation(invalid),null);
});
test('status remains explicit when a recognised document has no current report',()=>{
 assert.deepEqual(parseDiagnosticReconciliationStatus({recognized:true,report:null}),{status:'absent',report:null});
 assert.deepEqual(parseDiagnosticReconciliationStatus({recognized:false,report:null}),{status:'disabled',report:null});
 assert.equal(parseDiagnosticReconciliationStatus({recognized:true,report:value}).status,'current');
 assert.equal(parseDiagnosticReconciliationStatus({recognized:false,report:value}).status,'unavailable');
 assert.equal(parseDiagnosticReconciliationStatus({recognized:true}).status,'unavailable');
});
test('a current receipt must match the separately loaded source comparison and every visible line',()=>{
 const unit={id:'one',page:7,reses_code:'S12345',observed_service_code:'1.2.3',amount:110};
 const comparison={declaredNetCents:10000,totalCents:11000};
 assert.equal(matchesDiagnosticReconciliation(value,comparison,[unit]),true);
 for(const invalid of [[{...unit,amount:111}],[{...unit,page:8}],[{...unit,reses_code:'S99999'}],[]])assert.equal(matchesDiagnosticReconciliation(value,comparison,invalid),false);
 assert.equal(matchesDiagnosticReconciliation(value,{...comparison,declaredNetCents:null},[unit]),false);
});
