import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNoProviderReceiptsForConcertReview,concertTitleReview,reviewConcertDiscard} from '../lib/cloud/concert-discard-review';
import {needsContractRepair} from '../lib/cloud/repair-contract';
import {applyScopeRules,requiresConcertScopeDiscardFence,type RoleFact} from '../lib/scope-rules';
import type {CloudDb} from '../lib/cloud/context';
import type {AnalysisOutput} from '../lib/analysis-contract';
import {CloudFailure,failureMessage} from '../lib/cloud/errors';

const discard:AnalysisOutput={classification:'discarded',reasons:['no_concert_award'],explanation:'Proposta de descart del model sense prova completa de la font.',service_description:'',target_population:'',evidence_ordinals:[],population_verified:false,social_service_verified:false,candidates:[]};
test('Concert discard becomes contextual human review without another repair',()=>{
 const result=reviewConcertDiscard(discard,'concert',1);
 assert.equal(result.classification,'insufficient_evidence');assert.deepEqual(result.reasons,[]);
 assert.deepEqual(result.evidence_ordinals,[1]);assert.equal(needsContractRepair(result),false);
 assert.equal((result as typeof result & {rule_audit:{concert_discard_review:{context_only:boolean}}}).rule_audit.concert_discard_review.context_only,true);
 assert.equal(discard.classification,'discarded');
});
test('role exclusions remain pending and Concert retains its provider receipt fence',async()=>{
 const quote='L administració signant és responsable de la transferència sense servei social.';
 const fact=(kind:string):RoleFact=>({value:'Administració',state:'known',kind,evidence_ordinals:[1],quotes:[quote]});
 const rules=applyScopeRules({...discard,classification:'insufficient_evidence',reasons:[],evidence_ordinals:[1]},
  {financier:fact('administration'),economic_recipient:fact('administration'),final_service:fact('no'),financial_instrument:fact('interadministrative_transfer')},[{content:quote}]);
 assert.equal(rules.classification,'insufficient_evidence');assert.equal(rules.rule_audit.proposed_discard_reason,'interadministrative_transfer');
 assert.equal(reviewConcertDiscard(rules,'concert',1).classification,'insufficient_evidence');
 assert.equal(reviewConcertDiscard(rules,'contractacio',1).classification,'insufficient_evidence');
 assert.equal(requiresConcertScopeDiscardFence('concert',rules),true);
 assert.equal(requiresConcertScopeDiscardFence('contractacio',rules),false);
 assert.equal(requiresConcertScopeDiscardFence('concert',{classification:'insufficient_evidence',rule_audit:{rule:'unknown_determinant_role'}}),false);
 assert.equal(requiresConcertScopeDiscardFence('concert',{classification:'discarded'}),true);
 const makeDb=(receipt:string|null)=>({from:(table:string)=>{let filter:string|null=null;const result=()=>({data:table==='cloud_checkpoints'&&receipt&&(filter===receipt||filter===null)?[{item_key:'ai:fixture:matching',state:receipt}]:[],error:null});const q={select:()=>q,eq:()=>q,like:()=>q,order:()=>q,contains:(_field:string,value:{state:string})=>{filter=value.state;return q;},limit:async()=>result(),range:async()=>result()};return q;}} as unknown as CloudDb);
 await assert.rejects(()=>assertNoProviderReceiptsForConcertReview(makeDb('sending'),'task'),(error:unknown)=>error instanceof CloudFailure&&error.kind==='provider_unknown');
 await assert.rejects(()=>assertNoProviderReceiptsForConcertReview(makeDb('unknown'),'task'),(error:unknown)=>error instanceof CloudFailure&&error.kind==='provider_unknown');
 await assert.rejects(()=>assertNoProviderReceiptsForConcertReview(makeDb('received'),'task'),(error:unknown)=>error instanceof CloudFailure&&error.kind==='provider_reconciliation');
 await assert.doesNotReject(()=>assertNoProviderReceiptsForConcertReview(makeDb(null),'task'));
});
test('a review cannot be generated without any contextual fragment',()=>{
 assert.throws(()=>reviewConcertDiscard(discard,'concert',0));
});
test('a title-based proposal remains provisional and pending without asserting a definitive act is absent',()=>{
 const result=reviewConcertDiscard({...discard,rule_audit:{version:'concert-title-no-award-v1',rule:'proposal',coverage_proven:false}},'concert',1);
 assert.equal(result.classification,'insufficient_evidence');
 assert.match(result.explanation,/provisional/i);assert.match(result.explanation,/pendent de contrastar/i);
 assert.match(result.explanation,/no acredita finançament nou/i);assert.doesNotMatch(result.explanation,/no existeix/i);
 assert.equal(result.rule_audit.rule,'proposal');
 const contract=reviewConcertDiscard({...discard,rule_audit:{version:'concert-title-no-award-v1',rule:'proposal'}},'contractacio',1);
 assert.equal(contract.classification,'discarded');
});
test('a spending authorisation remains pending without asserting that no award exists',()=>{
 const title='Autorització de la despesa anualitat 2026';
 assert.equal(concertTitleReview(title,[])?.kind,'spending');
 const result=reviewConcertDiscard({...discard,rule_audit:{version:'concert-title-no-award-v1',rule:'spending',coverage_proven:false}},'concert',1);
 assert.equal(result.classification,'insufficient_evidence');assert.deepEqual(result.reasons,[]);
 assert.match(result.explanation,/autorització de despesa/i);
 assert.match(result.explanation,/Per si sola no acredita una adjudicació/i);
 assert.match(result.explanation,/cal contrastar/i);assert.doesNotMatch(result.explanation,/no existeix/i);
 assert.equal(concertTitleReview(title,[{source_document_id:'pdf',content:'Resolc: 1. Assignar els serveis a les entitats.'}]),null);
});
test('a receipt pause reports a fixed message without provider details',()=>{
 for(const code of ['EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED','RECEIPT_QUERY_FAILED']){
  const message=failureMessage(new CloudFailure('internal',5,{operation:'concert_discard_review',code,message:'PRIVATE RESPONSE'}));
  assert.match(message,/revisar/i);assert.doesNotMatch(message,/PRIVATE/);
 }
});
test('a detected affirmative operative clause prevents an early title-only review',()=>{
 const title='Resolució de convocatòria de serveis';
 assert.equal(concertTitleReview(title,[{source_document_id:'pdf',content:'Antecedents.'},{source_document_id:'pdf',content:'Resolc: 1. Assignar els serveis a les entitats.'}]),null);
 assert.equal(concertTitleReview(title,[{source_document_id:'pdf',content:'Resolc: 1. Denegar la sol·licitud.'}])?.kind,'call');
});
