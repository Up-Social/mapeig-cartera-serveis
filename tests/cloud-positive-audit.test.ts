import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyPositiveAudit,positiveAuditSchema} from '../lib/cloud/positive-audit';
import type {OfficialService} from '../lib/official-catalog';
import type {AnalysisOutput} from '../lib/analysis-contract';
const all=[{service_code:'1.1',service_name:'Llar autònoma',benefit_type:'service'},{service_code:'1.2',service_name:'Residència assistida',benefit_type:'service'}] as OfficialService[];
const chunks=[{content:'El servei presta assistència residencial a persones dependents.'}];
const candidate=(code:string,score:number)=>({code,score,rationale:'initial',evidence_ordinals:[1],evidence_explanation:'initial',population_compatible:true,legal_reference:'reference'});
const result={classification:'in_portfolio',candidates:[candidate('1.1',.9),candidate('1.2',.8)],reasons:[],explanation:'initial',evidence_ordinals:[1],population_verified:true,social_service_verified:true,service_description:'residència',target_population:'dependents'} as AnalysisOutput;
const checks=[{code:'1.1',service_name:'Llar autònoma',compatible:false,explanation:'No acredita autonomia suficient per a una llar.',evidence_ordinal:1,quote:''},{code:'1.2',service_name:'Residència assistida',compatible:true,explanation:'Acredita assistència residencial a persones dependents.',evidence_ordinal:1,quote:'assistència residencial a persones dependents'}];
test('Specific positive audit removes incompatible higher-scored candidate without inventing replacements',()=>{const v=applyPositiveAudit(result,{checks},all,chunks);assert.equal(v.classification,'in_portfolio');assert.deepEqual(v.candidates.map(c=>[c.code,c.score]),[['1.2',.8]]);assert.equal(result.candidates.length,2);});
test('No compatible candidate means insufficient evidence, never out of portfolio',()=>{const v=applyPositiveAudit(result,{checks:checks.map(c=>({...c,compatible:false}))},all,chunks);assert.equal(v.classification,'insufficient_evidence');assert.deepEqual(v.candidates,[]);});
test('Audit rejects missing, repeated, invented, misnamed and unsupported evidence results',()=>{for(const invalid of [checks.slice(1),[checks[1],checks[1]],[checks[0],{...checks[1],code:'1.3'}],[checks[0],{...checks[1],service_name:'Llar autònoma'}],[checks[0],{...checks[1],quote:'Aquesta cita és inventada'}],[checks[0],{...checks[1],evidence_ordinal:2}]])assert.throws(()=>applyPositiveAudit(result,{checks:invalid},all,chunks));});
test('Audit preserves score ordering and only permits proposed codes',()=>{const v=applyPositiveAudit(result,{checks:checks.map(c=>({...c,compatible:true,quote:checks[1].quote}))},all,chunks);assert.deepEqual(v.candidates.map(c=>c.score),[.9,.8]);assert.deepEqual(positiveAuditSchema(['1.1']).properties.checks.items.properties.code.enum,['1.1']);});

test('Audit quote choices come exclusively from document text',()=>{const choices=positiveAuditSchema(['1.2'],chunks).properties.checks.items.properties.quote.enum;assert.deepEqual(choices,['',chunks[0].content]);});

test('literal quotation can resolve one misplaced in-range ordinal without changing the text',()=>{
 const evidence=[{content:'Other synthetic source, unrelated.'},...chunks];
 const result2=applyPositiveAudit(result,{checks},all,evidence);assert.deepEqual(result2.candidates[0].evidence_ordinals,[2]);assert.equal(checks[1].evidence_ordinal,1);
});
test('missing or ambiguous quotation never resolves to an arbitrary source',()=>{
 const evidence=[{content:'Other synthetic source, unrelated.'},...chunks,...chunks];
 assert.throws(()=>applyPositiveAudit(result,{checks},all,evidence),/POSITIVE_AUDIT_EVIDENCE/);
});
