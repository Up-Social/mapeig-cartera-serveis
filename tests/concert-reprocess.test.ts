import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConcertReprocess} from '../components/concert-reprocess';
import {parseConcertReprocessPending,observedConcertReprocess,concertReprocessRequest,canRetryConcertReprocess,canClearRejectedConcertRequest} from '../lib/concerts/reprocess-recovery';

const base={recordId:'current-record',historical:false,busy:false,active:false,cloudBlocked:false,recoveryReady:true,recoveryPending:false,recoveryChecking:false,recoveryRetryable:false,message:'',error:'',onReprocess:()=>{},onCheckStatus:()=>{},onRetryPending:()=>{}};
test('a current concert has one complete reprocessing action with its cost and review scope',()=>{
  const html=renderToStaticMarkup(createElement(ConcertReprocess,base));
  assert.equal((html.match(/<button/g)??[]).length,1);
  assert.doesNotMatch(html,/disabled=/);
  assert.match(html,/cost d’IA i OCR/);
  assert.match(html,/nova proposta requereix revisió humana/);
});
test('historical and unavailable operations remain visible with an explicit blocking reason',()=>{
  for(const [change,reason] of [
    [{historical:true},/execució històrica/],
    [{active:true},/operació en curs/],
    [{busy:true},/Espera que acabi/],
    [{cloudBlocked:true},/entorn de consulta/],
    [{recoveryPending:true},/petició pendent de confirmar/],
    [{recoveryReady:false},/Comprovant si hi ha una petició anterior/],
  ] as const){
    const html=renderToStaticMarkup(createElement(ConcertReprocess,{...base,...change}));
    assert.match(html,/disabled=""/);
    assert.match(html,/aria-describedby="concert-reprocess-blocked"/);
    assert.match(html,reason);
  }
  const html=renderToStaticMarkup(createElement(ConcertReprocess,{...base,historical:true}));
  assert.match(html,/href="\/records\/current-record#concert-reprocess"/);
});
test('uncertain requests only unlock after an actual current job change, never mere inactivity',()=>{
  const id='00000000-0000-4000-8000-000000000001',previous='00000000-0000-4000-8000-000000000002',next='00000000-0000-4000-8000-000000000003';
  const marker=parseConcertReprocessPending(JSON.stringify({recordId:id,expectedJobId:previous}),id);
  assert.equal(observedConcertReprocess(marker,{id,currentJobId:previous}),false);
  assert.equal(observedConcertReprocess(marker,{id,currentJobId:null}),false);
  assert.equal(observedConcertReprocess(marker,{id,currentJobId:next}),true);
  assert.equal(observedConcertReprocess(marker,{id:next,currentJobId:next}),false);
  assert.equal(observedConcertReprocess({...marker,jobId:next},{id,currentJobId:previous}),false);
  assert.equal(observedConcertReprocess({...marker,jobId:next},{id,currentJobId:next}),true);
  assert.equal(observedConcertReprocess({...marker,jobId:next},{id,currentJobId:"33333333-3333-4333-8333-333333333333"}),true);
  assert.equal(observedConcertReprocess({...marker,expectedJobId:null},{id,currentJobId:next}),true);
  assert.throws(()=>parseConcertReprocessPending(JSON.stringify({recordId:next,expectedJobId:previous}),id));
  assert.throws(()=>parseConcertReprocessPending(JSON.stringify({recordId:id}),id));
});
test('the action exposes server diagnostics and operation messages accessibly',()=>{
  const html=renderToStaticMarkup(createElement(ConcertReprocess,{...base,error:'Cal comprovar la petició anterior.',message:'Operació en cua.'}));
  assert.match(html,/role="alert"[^>]*>Cal comprovar la petició anterior/);
  assert.match(html,/role="status"[^>]*>Operació en cua/);
});
test('an uncertain request can be resent explicitly, but a known job only permits status checks',()=>{
 const uncertain=renderToStaticMarkup(createElement(ConcertReprocess,{...base,recoveryPending:true,recoveryRetryable:true}));
 assert.match(uncertain,/Reenviar la mateixa petició/);
 assert.match(uncertain,/referència original/);
 assert.match(uncertain,/aria-describedby="concert-retry-explanation"/);
 for(const change of [{recoveryRetryable:false},{historical:true}]){
  const html=renderToStaticMarkup(createElement(ConcertReprocess,{...base,recoveryPending:true,recoveryRetryable:true,...change}));
  assert.doesNotMatch(html,/Reenviar la mateixa petició/);
 }
 for(const change of [{busy:true},{active:true},{cloudBlocked:true},{recoveryChecking:true},{recoveryReady:false}]){
  const html=renderToStaticMarkup(createElement(ConcertReprocess,{...base,recoveryPending:true,recoveryRetryable:true,...change}));
  assert.match(html,/aria-describedby="concert-retry-explanation" disabled=""/);
 }
});
test('retry preserves the original CAS even after another job is observed and never clears uncertainty on rejection',()=>{
 const id='00000000-0000-4000-8000-000000000001',previous='00000000-0000-4000-8000-000000000002',next='00000000-0000-4000-8000-000000000003';
 for(const expectedJobId of [previous,null]){
  const marker=parseConcertReprocessPending(JSON.stringify({recordId:id,expectedJobId}),id);
  const original=concertReprocessRequest(marker);
  assert.equal(canRetryConcertReprocess(marker),true);
  assert.equal(observedConcertReprocess(marker,{id,currentJobId:next}),true);
  assert.deepEqual(concertReprocessRequest(marker),original);
  assert.equal(original.expectedJobId,expectedJobId);
  assert.equal(canRetryConcertReprocess({...marker,jobId:next}),false);
 }
 assert.equal(canRetryConcertReprocess(null),false);
 assert.equal(canClearRejectedConcertRequest(false,'not_started'),true);
 assert.equal(canClearRejectedConcertRequest(true,'not_started'),false);
 assert.equal(canClearRejectedConcertRequest(true,undefined),false);
 assert.equal(canClearRejectedConcertRequest(false,undefined),false);
});
