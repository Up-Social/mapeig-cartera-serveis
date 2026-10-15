import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFinancingClassification,type AnalysisOutput} from '../lib/analysis-contract';
import {candidatesOnlySchema} from '../lib/pipeline/matching-schema';
import {isReviewOutcomeAllowed,reviewOptions} from '../lib/review-contract';
import {currentReservation,effectiveUnitCode,canResolveManually,type DocumentedCorrection,type Reservation} from '../lib/human-resolution';
import {classifyIssue} from '../lib/issue-types';
import type {SourceRecord} from '../lib/workbench-types';
const outside:AnalysisOutput={classification:'out_of_portfolio',reasons:[],explanation:'Conclusió automàtica anterior amb els destinataris acreditats.',service_description:'Servei social',target_population:'Destinataris',evidence_ordinals:[1],population_verified:true,social_service_verified:true,candidates:[]};
const reservation:Reservation={id:'decision',pipeline_job_id:'job',action:'accept',reason:'Cal contrastar el servei',missing_items:'Falta el codi acreditat',reviewer:'Revisor declarat',created_at:'2026-10-15T09:00:00Z'};
test('concert response contract and manual decisions exclude outside, all other types retain it',()=>{
 for(const typ of ['concert','contractacio','conveni','subvencio']){
  assert.equal(candidatesOnlySchema(undefined,typ).properties.classification.enum.some(value=>String(value)==='out_of_portfolio'),typ!=='concert');
  assert.equal(isReviewOutcomeAllowed(typ,'outside'),typ!=='concert');
  assert.equal(reviewOptions(typ).some(o=>o.value==='select'),true);
  assert.equal(isReviewOutcomeAllowed(typ,'invented'),false);
 }
});
test('replayed outside concert becomes pending without inventing an approval, rejection or modifying original',()=>{
 const before=structuredClone(outside),result=applyFinancingClassification(outside,'concert');
 assert.equal(result.classification,'insufficient_evidence');assert.deepEqual(result.candidates,[]);assert.deepEqual(result.reasons,[]);
 assert.deepEqual(outside,before);assert.strictEqual(applyFinancingClassification(outside,'conveni'),outside);
 assert.deepEqual(result.evidence_ordinals,[1]);
});
test('current reservation is tied to its actual attempt and does not rewrite history',()=>{
 assert.equal(currentReservation({currentJobId:'job',reservation}),reservation);
 assert.equal(currentReservation({currentJobId:'new-job',reservation}),null);
 assert.equal(currentReservation({currentJobId:'job',reservation,isHistorical:true}),null);
 assert.equal(currentReservation({currentJobId:'job',reservation:{...reservation,action:'reopen'}}),null);
});
test('an invalidated correction never supplies a service code or falls back to an older correction',()=>{
 const unit={id:'unit',observed_service_code:null};
 const correction={unit_id:'unit',field:'service_code',value:'1.2.6',valid:true} as DocumentedCorrection;
 assert.equal(effectiveUnitCode(unit,[correction]),'1.2.6');
 assert.equal(effectiveUnitCode(unit,[{...correction,valid:false}]),null);
 assert.equal(effectiveUnitCode({...unit,id:'other'},[correction]),null);
 assert.equal(unit.observed_service_code,null);
});
test('manual resolution is unavailable for running, approved and historical attempts',()=>{
 for(const status of ['matching','queued','approved','corrected'])assert.equal(canResolveManually({currentJobId:'job',currentJobStatus:status}),false);
 assert.equal(canResolveManually({currentJobId:'job',currentJobStatus:'needs_review'}),true);
 assert.equal(canResolveManually({currentJobId:'job',currentJobStatus:'needs_review',isHistorical:true}),false);
 assert.equal(canResolveManually({currentJobId:'job',currentJobStatus:'needs_review',operationProgress:{state:'active'}}),false);
});
test('accepted reservations leave ordinary insufficient queue but cannot hide new technical errors',()=>{
 const record={currentJobId:'job',currentJobStatus:'needs_review',financingType:'concert',reservation,evidenceStatus:'ready',enrichmentStatus:'completed',sourceDocuments:[],analysis:{classification:'insufficient_evidence',explanation:'Falta evidència',reliability_status:'valid'}} as unknown as SourceRecord;
 assert.equal(classifyIssue(record),null);
 assert.equal(classifyIssue({...record,currentJobStatus:'error',matchingError:'Error tècnic'})?.category,'matching_error');
 assert.equal(classifyIssue({...record,currentJobId:'new-job'})?.category,'insufficient_evidence');
 assert.equal(classifyIssue({...record,reservation:{...reservation,action:'reopen'}})?.category,'insufficient_evidence');
});
