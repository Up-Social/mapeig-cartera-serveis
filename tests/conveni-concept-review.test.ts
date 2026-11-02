import test from 'node:test';
import assert from 'node:assert/strict';
import {conceptReviewRpcArgs,parseConceptReview,conceptReviewState} from '../lib/convenis/concept-review';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const body={action:'review-concept',jobId:id(1),unitId:id(2),eventId:id(3),conceptIndex:0,
 previousConceptReviewId:id(4),parentReviewId:id(5),conceptHash:'a'.repeat(64),sourceHash:'b'.repeat(32),
 documentRevisions:{[id(6)]:`${'c'.repeat(64)}:`},outcome:'select',serviceCode:'1.1.1',
 note:'Revisió documental del concepte',citation:{document_id:id(6),page:2,quote:'Text documental amb la cita literal.'},socialConfirmed:true};

test('individual review keeps hash, original citation and both predecessor tokens unchanged for the atomic RPC',()=>{
 const parsed=parseConceptReview(body);const args=conceptReviewRpcArgs(id(7),parsed);
 assert.equal(args.p_record,id(7));assert.equal(args.p_index,0);assert.equal(args.p_previous,id(4));assert.equal(args.p_parent_review,id(5));
 assert.equal(args.p_expected_hash,body.conceptHash);assert.equal(args.p_source_hash,body.sourceHash);assert.deepEqual(args.p_revisions,body.documentRevisions);
 assert.deepEqual(args.p_citation,body.citation);assert.equal(args.p_social_confirmed,true);assert.equal(args.p_code,'1.1.1');
 assert.ok(!('amount' in args));
});

test('malformed or incomplete concurrency and documentary proof are rejected before the RPC',()=>{
 for(const patch of [
  {conceptIndex:-1},{conceptIndex:1.5},{conceptHash:'a'.repeat(63)},{sourceHash:''},
  {parentReviewId:'bad'},{previousConceptReviewId:'bad'},{documentRevisions:[]},
  {documentRevisions:{bad:'anything'}},{citation:{...body.citation,page:0}},
  {citation:{...body.citation,quote:'short'}},{citation:{...body.citation,document_id:'bad'}},
 ])assert.throws(()=>parseConceptReview({...body,...patch}));
 assert.throws(()=>conceptReviewRpcArgs('bad',parseConceptReview(body)));
});

test('positive decisions require an attestation and a valid select decision; pending decisions stay pending',()=>{
 assert.throws(()=>parseConceptReview({...body,socialConfirmed:false}));
 assert.throws(()=>parseConceptReview({...body,serviceCode:''}));
 assert.throws(()=>parseConceptReview({...body,outcome:'insufficient',socialConfirmed:true}));
 const pending=parseConceptReview({...body,outcome:'insufficient',socialConfirmed:false,serviceCode:'1.1.1'});
 assert.equal(pending.serviceCode,null);assert.equal(conceptReviewRpcArgs(id(7),pending).p_outcome,'insufficient');
});


test('the last review token is not presented as current when freshness is false or missing',()=>{
 assert.equal(conceptReviewState(null,false,null),'pending');
 assert.equal(conceptReviewState(null,false,null,true),'historical');
 assert.equal(conceptReviewState(id(4),true,'select'),'current');
 assert.equal(conceptReviewState(id(4),true,'insufficient'),'incomplete');
 assert.equal(conceptReviewState(id(4),true,null),'stale');
 for(const value of [false,null,undefined,'true',1])assert.equal(conceptReviewState(id(4),value,'select'),'stale');
});

test('concept history is scoped to its original job and unit, even when indices repeat',async()=>{
 const {eventsForConcept}=await import('../lib/convenis/concept-history');
 const events=[{job_id:id(1),unit_id:id(2),concept_index:0,sequence:2},{job_id:id(8),unit_id:id(2),concept_index:0,sequence:1},{job_id:id(1),unit_id:id(9),concept_index:0,sequence:1},{job_id:id(1),unit_id:id(2),concept_index:1,sequence:1}];
 assert.deepEqual(eventsForConcept(events,id(1),id(2),0),[events[0]]);
 assert.deepEqual(eventsForConcept(events,id(8),id(2),0),[events[1]]);
});

test('units and both audit histories are completely paged, and any page error fails closed',async()=>{
 const {readConveniReviewPages}=await import('../lib/convenis/review-pages');
 const units=Array.from({length:1201},(_,i)=>({id:i}));
 const unitHistory=Array.from({length:1001},(_,i)=>({id:i}));
 const conceptHistory=Array.from({length:1302},(_,i)=>({id:i}));
 const page=<T>(data:T[])=>(from:number,to:number)=>Promise.resolve({data:data.slice(from,to+1),error:null});
 const result=await readConveniReviewPages(page(units),page(unitHistory),page(conceptHistory));
 assert.equal(result.unitRows.length,1201);assert.equal(result.reviewRows.length,1001);assert.equal(result.conceptRows.length,1302);
 const fail=(from:number,to:number)=>Promise.resolve(from>=500?{data:null,error:new Error('history unavailable')}:{data:conceptHistory.slice(from,to+1),error:null});
 await assert.rejects(()=>readConveniReviewPages(page(units),page(unitHistory),fail),/history unavailable/);
});


test('concept history never treats a reused index as proof of matching snapshot',async()=>{
 const {conceptHistoryVersion}=await import('../lib/convenis/concept-history');
 const first='a'.repeat(64),second='b'.repeat(64);
 assert.equal(conceptHistoryVersion(first,first),'same');
 assert.equal(conceptHistoryVersion(first,second),'different');
 assert.equal(conceptHistoryVersion(undefined,first),'unknown');
 assert.equal(conceptHistoryVersion(first,'bad'),'unknown');
});
