import assert from 'node:assert/strict';
import test from 'node:test';
import {batchResultClassification, batchResultGuidance} from '../lib/batch-result-guidance';
import type {BatchJob} from '../lib/batch-types';

const analysis = {
 id:'analysis', classification:'insufficient_evidence' as const, reasons:[],
 explanation:'Proposta pendent de contrastar', service_description:'', target_population:'',
 catalog_version_id:'v', rules_version:'v', reviewed_classification:null, review_notes:null, evidence:[],
 rule_audit:{version:'concert-title-no-award-v1',rule:'proposal'},
};
const job = {
 id:'job', sourceRecordId:'source', sourceDataset:'raisc_ccaa', financingType:'concert',
 externalId:'EXP', title:'Proposta', status:'needs_review', currentDestination:'issues',
 preparationStatus:'ready', preparationMessage:null, errorMessage:null, enrichmentStatus:'completed',
 enrichmentError:null, processingStatus:'needs_review', analysis, matchingCandidates:[], hasProvision:false,
 phases:{preparation:'completed',enrichment:'completed',matching:'completed'},
} as BatchJob;

test('provisional concert guidance preserves issue and classification without claiming finance was blocked',()=>{
 const before=JSON.stringify(job);
 const result=batchResultGuidance(job);
 assert.equal(result.kind,'issue');
 assert.match(result.label,/possible proposta provisional/);
 assert.match(result.explanation,/no acredita finançament nou/);
 assert.match(result.explanation,/contrast/);
 assert.equal(batchResultClassification(job),'insufficient_evidence');
 assert.equal(JSON.stringify(job),before);
});

test('other typologies, invalidated results and technical errors retain existing guidance',()=>{
 assert.doesNotMatch(batchResultGuidance({...job,financingType:'conveni'}).label,/provisional/);
 assert.doesNotMatch(batchResultGuidance({...job,analysis:{...analysis,reliability_status:'invalidated'}}).label,/provisional/);
 assert.equal(batchResultGuidance({...job,status:'error'}).kind,'technical');
 assert.doesNotMatch(batchResultGuidance({...job,analysis:{...analysis,rule_audit:{...analysis.rule_audit,rule:'other'}}}).label,/provisional/);
 assert.doesNotMatch(batchResultGuidance({...job,analysis:{...analysis,reviewed_classification:'in_portfolio'}}).label,/provisional/);
});
