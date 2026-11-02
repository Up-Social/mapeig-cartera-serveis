import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {projectBatchCandidates} from '../lib/batch-candidate-projection';
import {BatchCandidateObservations} from '../components/batch-candidate-observations';
import {batchResultClassification,batchResultGuidance} from '../lib/batch-result-guidance';
import {eligibleServices,type OfficialService} from '../lib/official-catalog';
import officialSnapshot from '../data/legal/cartera.json';
import type {StoredAnalysis} from '../lib/analysis-contract';
import type {BatchJob} from '../lib/batch-types';

const analysis:StoredAnalysis={id:'a',classification:'in_portfolio',reasons:[],explanation:'Proposta sintètica',service_description:'Servei',target_population:'Persones',catalog_version_id:'v1',rules_version:'evidence-roles-v4',reviewed_classification:null,review_notes:null,evidence:[{content:'Evidència'}]};
const leaf=eligibleServices(officialSnapshot.services as OfficialService[])[0];
const base={pipeline_job_id:'job',rank:1,score:.8,rationale:'Justificació sintètica',engine_version:'synthetic',catalog_version_id:'v1',matching_candidate_evidence:[{explanation:'Explicació guardada',evidence_chunks:{ordinal:1,content:'Fragment guardat'}}]};
const leafCandidate={...base,id:'leaf',target_code:leaf.service_code,target_name:'Fulla'};
const parentCandidate={...base,id:'parent',rank:2,target_code:'1.2',target_name:'Agrupador'};
const unknownCandidate={...base,id:'unknown',rank:3,target_code:'999.999',target_name:'Històric'};
const jobBase:BatchJob={id:'job',sourceRecordId:'record',sourceDataset:'contractacions',financingType:'concert',externalId:'synthetic',title:'Cas',status:'needs_review',analysis,matchingCandidates:[],hasProvision:false,preparationStatus:'ready',preparationMessage:null,errorMessage:null,enrichmentStatus:'completed',enrichmentError:null,processingStatus:'needs_review'};

test('batch preserves version and evidence for filtered candidates without changing review classification',()=>{
 const raw={id:'job',matching_candidates:[leafCandidate,parentCandidate,unknownCandidate]};const before=JSON.stringify(raw);
 const projected=projectBatchCandidates(raw,analysis);
 assert.deepEqual(projected.matchingCandidates.map(item=>item.id),['leaf']);
 assert.deepEqual(projected.unverifiedCandidateObservations.map(item=>item.id),['parent','unknown']);
 assert.equal(projected.unverifiedCandidateObservations[0].catalogVersionId,'v1');
 assert.equal(projected.unverifiedCandidateObservations[0].evidence[0].content,'Fragment guardat');
 assert.equal(projected.analysis,analysis);assert.equal(JSON.stringify(raw),before);
 const beforeJob={...jobBase,matchingCandidates:projected.matchingCandidates};
 const afterJob={...beforeJob,unverifiedCandidateObservations:projected.unverifiedCandidateObservations};
 assert.equal(batchResultClassification(afterJob),batchResultClassification(beforeJob));
 assert.deepEqual(batchResultGuidance(afterJob),batchResultGuidance(beforeJob));
 const html=renderToStaticMarkup(createElement(BatchCandidateObservations,{job:afterJob}));
 assert.match(html,/Agrupador/);assert.match(html,/Històric/);assert.match(html,/v1/);assert.match(html,/Fragment guardat/);
 assert.doesNotMatch(html,/<a\b|<button\b|<input\b|<select\b/);
});

test('a zero score or prior invalidation hides both selectable and unverified batch sets',()=>{
 const raw={id:'job',matching_candidates:[leafCandidate,{...parentCandidate,score:0}]};
 const zero=projectBatchCandidates(raw,analysis);
 assert.deepEqual(zero.matchingCandidates,[]);assert.deepEqual(zero.unverifiedCandidateObservations,[]);
 assert.equal(zero.analysis?.reliability_status,'invalidated');
 const invalid=projectBatchCandidates({id:'job',matching_candidates:[leafCandidate,parentCandidate]},{...analysis,reliability_status:'invalidated'});
 assert.deepEqual(invalid.matchingCandidates,[]);assert.deepEqual(invalid.unverifiedCandidateObservations,[]);
 const staleProp={...jobBase,analysis:{...analysis,reliability_status:'invalidated' as const},unverifiedCandidateObservations:[{id:'stale',targetCode:'1.2',targetName:'No mostrar',catalogVersionId:'v1',rationale:null,evidence:[]}]};
 assert.equal(renderToStaticMarkup(createElement(BatchCandidateObservations,{job:staleProp})), '');
 const withoutAnalysis=projectBatchCandidates(raw,null);
 assert.deepEqual(withoutAnalysis.matchingCandidates,[]);assert.deepEqual(withoutAnalysis.unverifiedCandidateObservations,[]);
});

test('a verification job in its own batch remains scoped to that job',()=>{
 const verification={id:'verification',verification_only:true,matching_candidates:[{...parentCandidate,pipeline_job_id:'verification'}]};
 const projected=projectBatchCandidates(verification,analysis);
 assert.deepEqual(projected.unverifiedCandidateObservations.map(item=>item.id),['parent']);
 assert.deepEqual(projected.matchingCandidates,[]);
});
