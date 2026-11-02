import test from 'node:test';
import assert from 'node:assert/strict';
import {latestJobInvalidCandidateReason} from '../lib/candidate-reliability';
import {projectLatestCandidates} from '../lib/candidate-projection';
import {eligibleServices,type OfficialService} from '../lib/official-catalog';
import officialSnapshot from '../data/legal/cartera.json';
import {effectiveJobs} from '../lib/effective-jobs';

test('checks every stored candidate before hiding unknown catalog codes',()=>{
 const job={id:'job',created_at:'2026-10-30',matching_candidates:[{target_code:'1.2.3',score:0.9},{target_code:'1.2',score:0}]};
 assert.equal(latestJobInvalidCandidateReason([job]),'non_positive_confidence');
 assert.equal(latestJobInvalidCandidateReason([{...job,matching_candidates:[{target_code:'1.2.3',score:0.9},{target_code:'1.2',score:'0.4'}]}]),null);
});

test('uses the same latest-job ordering and does not inherit an older invalid score',()=>{
 const older={id:'a',created_at:'2026-10-29',matching_candidates:[{score:0}]};
 const newer={id:'b',created_at:'2026-10-30',matching_candidates:[{score:0.6}]};
 assert.equal(latestJobInvalidCandidateReason([newer,older]),null);
 assert.equal(latestJobInvalidCandidateReason([older,{...newer,created_at:older.created_at}]),null);
 assert.equal(latestJobInvalidCandidateReason([{...newer,created_at:older.created_at}, {...older,id:'z'}]),'non_positive_confidence');
});

test('rejects malformed and out-of-range scores without turning absent candidates into an error',()=>{
 for(const score of [null,undefined,'',-1,0,1.01,NaN,Infinity,'not-a-number']){
  assert.ok(latestJobInvalidCandidateReason([{matching_candidates:[{score}]}]),String(score));
 }
 for(const score of [0.001,0.5,1,'0.7'])assert.equal(latestJobInvalidCandidateReason([{matching_candidates:[{score}]}]),null,String(score));
 for(const input of [null,[],[{}],[{matching_candidates:null}],[{matching_candidates:[]}]])assert.equal(latestJobInvalidCandidateReason(input),null);
 assert.deepEqual(projectLatestCandidates([null,[],{id:'job',matching_candidates:[]}]),{candidates:[],observations:[],invalidScoreReason:null});
});

test('the shared record and batch projection hides all candidates when a filtered one has zero score',()=>{
 const eligible=eligibleServices(officialSnapshot.services as OfficialService[])[0];assert.ok(eligible);
 const candidate={id:'visible',pipeline_job_id:'job',rank:1,target_code:eligible.service_code,target_name:'Servei',score:0.9,rationale:'',engine_version:'synthetic',matching_candidate_evidence:[]};
 const job={id:'job',created_at:'2026-10-30',matching_candidates:[candidate,{...candidate,id:'hidden',rank:2,target_code:'999.999.999',score:0}]};
 const projected=projectLatestCandidates([job]);
 assert.equal(projected.invalidScoreReason,'non_positive_confidence');assert.deepEqual(projected.candidates,[]);assert.deepEqual(projected.observations,[]);
 const valid=projectLatestCandidates([{...job,matching_candidates:[candidate]}]);
 assert.equal(valid.invalidScoreReason,null);assert.equal(valid.candidates[0]?.id,'visible');
});

test('filtered parent and unknown code remain separate, read-only observations with their original evidence',()=>{
 const services=officialSnapshot.services as OfficialService[];
 const leaves=eligibleServices(services);const eligible=leaves[0];
 const parent=services.find(service=>service.benefit_type==='service'&&!leaves.some(leaf=>leaf.service_code===service.service_code));
 assert.ok(parent);assert.ok(eligible);
 const candidate={id:'leaf',pipeline_job_id:'job',rank:1,target_code:eligible.service_code,target_name:'Fulla',score:0.9,rationale:'Encaix acreditat',catalog_version_id:'v1',engine_version:'synthetic',matching_candidate_evidence:[]};
 const evidence=[{explanation:'Explicació guardada',evidence_chunks:{ordinal:2,content:'Fragment guardat'}}];
 const parentCandidate={...candidate,id:'parent',rank:2,target_code:parent.service_code,target_name:'Nom original d’agrupador',rationale:'Justificació històrica',matching_candidate_evidence:evidence};
 const unknown={...candidate,id:'unknown',rank:3,target_code:'999.999.999',target_name:'Nom històric desconegut',matching_candidate_evidence:evidence};
 const jobs=[{id:'job',created_at:'2026-10-30',matching_candidates:[candidate,parentCandidate,unknown]}];const before=JSON.stringify(jobs);
 const projected=projectLatestCandidates(jobs);
 assert.deepEqual(projected.candidates.map(c=>c.id),['leaf']);
 assert.deepEqual(projected.observations.map(c=>c.id),['parent','unknown']);
 assert.equal(projected.observations[0].targetCode,parent.service_code);assert.equal(projected.observations[0].catalogVersionId,'v1');
 assert.equal(projected.observations[0].rationale,'Justificació històrica');
 assert.deepEqual(projected.observations[0].evidence,[{ordinal:2,content:'Fragment guardat',explanation:'Explicació guardada'}]);
 assert.equal(JSON.stringify(jobs),before);
 assert.ok(projected.observations.every(o=>!projected.candidates.some(c=>c.id===o.id)));
});

test('observations use only the effective latest job and never leak from an invalid score',()=>{
 const parent='1.2';
 const observation={id:'parent',pipeline_job_id:'job',rank:1,target_code:parent,target_name:'Agrupador',score:.9,rationale:'',engine_version:'synthetic',matching_candidate_evidence:[]};
 const jobs=[{id:'job',created_at:'2026-10-29',matching_candidates:[observation]},{id:'verification',created_at:'2026-10-30',verification_only:true,matching_candidates:[{...observation,id:'excluded',score:0}]}];
 const result=projectLatestCandidates(effectiveJobs(jobs));
 assert.deepEqual(result.observations.map(o=>o.id),['parent']);assert.deepEqual(result.candidates,[]);
 const invalid=projectLatestCandidates([{...jobs[0],matching_candidates:[{...observation,score:0}]}]);
 assert.deepEqual(invalid.observations,[]);assert.deepEqual(invalid.candidates,[]);
});

test('record projection ignores newer verification-only jobs before assessing reliability',()=>{
 const eligible=eligibleServices(officialSnapshot.services as OfficialService[])[0];assert.ok(eligible);
 const candidate={id:'visible',pipeline_job_id:'job',rank:1,target_code:eligible.service_code,target_name:'Servei',score:0.7,rationale:'',engine_version:'synthetic',matching_candidate_evidence:[]};
 const jobs=[{id:'job',created_at:'2026-10-29',matching_candidates:[candidate]},{id:'verification',created_at:'2026-10-30',verification_only:true,matching_candidates:[{...candidate,score:0}]}];
 const recordProjection=projectLatestCandidates(effectiveJobs(jobs));
 assert.equal(recordProjection.invalidScoreReason,null);assert.equal(recordProjection.candidates[0]?.id,'visible');
 assert.equal(projectLatestCandidates([jobs[1]]).invalidScoreReason,'non_positive_confidence');
});

test('bundled legal reference is attributed only to the same recorded catalog version',()=>{
 const eligible=eligibleServices(officialSnapshot.services as OfficialService[]).find(service=>!!service.legal_reference);assert.ok(eligible);
 const candidate={id:'synthetic',pipeline_job_id:'job',rank:1,target_code:eligible.service_code,target_name:eligible.service_name,score:0.7,rationale:'',engine_version:'synthetic',matching_candidate_evidence:[]};
 const project=(version:string|null)=>projectLatestCandidates([{id:'job',matching_candidates:[{...candidate,catalog_version_id:version}]}]).candidates[0];
 assert.equal(project(officialSnapshot.version.id).legalReference,eligible.legal_reference);
 assert.equal(project('other-version').legalReference,undefined);
 assert.equal(project(null).legalReference,undefined);
 assert.equal(project('other-version').catalogVersionId,'other-version');
});
