import {test} from 'node:test';
import assert from 'node:assert/strict';
import {concertLineAmountSummary} from '../lib/concerts/line-summary';

const sha='a'.repeat(64);
const first={document_id:'document-a',unit_key:`official-annex:${sha}:0:1`,storage_sha256:sha,evidence_quote:'Fila A',act_type:'award',amount:0.1};
const second={...first,unit_key:`official-annex:${sha}:0:2`,evidence_quote:'Fila B',amount:0.2};
const report={document_id:'document-a',document_sha256:sha,annex:0,row_count:2,sum_cents:30,reconciled:true};

test('a reconciled documentary subtotal uses exact cents and never declares a balance',()=>{
 assert.deepEqual(concertLineAmountSummary([first,second],[report],true),{count:2,totalCents:30,reason:null});
 const zeroReport={...report,row_count:1,sum_cents:0};
 assert.deepEqual(concertLineAmountSummary([{...first,amount:0}],[zeroReport],true),{count:1,totalCents:0,reason:null});
 assert.deepEqual(concertLineAmountSummary([{...first,amount:null}],[],true),{count:0,totalCents:null,reason:'none'});
});

test('subtotal is suppressed without a single matching reconciled annex and complete distinct lines',()=>{
 for(const modified of [{...second,document_id:'document-b'},{...second,document_id:null},
  {...second,act_type:'renewal'},{...second,act_type:'amendment'},{...second,act_type:'modification'},
  {...second,unit_key:`official-annex:${sha}:6:2`},{...second,unit_key:first.unit_key},
  {...second,evidence_quote:first.evidence_quote},{...second,evidence_quote:null},{...second,amount:null}]){
  assert.equal(concertLineAmountSummary([first,modified],[report],true).totalCents,null);
 }
 for(const badReport of [{...report,reconciled:false},{...report,document_sha256:'b'.repeat(64)},
  {...report,row_count:3},{...report,sum_cents:29}]){
  assert.equal(concertLineAmountSummary([first,second],[badReport],true).totalCents,null);
 }
 assert.equal(concertLineAmountSummary([first,second],[],true).totalCents,null);
 assert.equal(concertLineAmountSummary([first,second],[report],false).totalCents,null);
});

test('pending re-extraction and invalid or unsafe values do not result in a total',()=>{
 assert.equal(concertLineAmountSummary([first,{...second,observation:{pendingRevision:true}}],[report],true).reason,'pending_revision');
 for(const amount of [1.001,-1,Number.NaN,Number.POSITIVE_INFINITY,2**45]){
  assert.deepEqual(concertLineAmountSummary([first,{...second,amount}],[report],true),{count:2,totalCents:null,reason:'invalid'});
 }
});
