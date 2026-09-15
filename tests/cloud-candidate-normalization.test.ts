import {test} from 'node:test';import assert from 'node:assert/strict';
import {normalizeCandidates} from '../lib/cloud/normalize-candidates';
import {needsContractRepair,contractRepairSchema} from '../lib/cloud/repair-contract';
import {validateAnalysis,type AnalysisOutput} from '../lib/analysis-contract';
import type {OfficialService} from '../lib/official-catalog';
const all=[{service_code:'1',benefit_type:'service',legal_reference:'parent'},{service_code:'1.1',benefit_type:'service',legal_reference:'official 1.1'},{service_code:'1.2',benefit_type:'service',legal_reference:'official 1.2'},{service_code:'2',benefit_type:'economic',legal_reference:'economic'}] as OfficialService[];
const candidate=(code:string,score:number,compatible=true)=>({code,score,population_compatible:compatible,legal_reference:'model text',evidence_ordinals:[1],rationale:'Synthetic rationale for a documented service',evidence_explanation:'Synthetic source'});
const base:AnalysisOutput={classification:'in_portfolio',candidates:[candidate('1.1',.7),candidate('1.2',.9)],reasons:[],explanation:'Synthetic documented matching evidence',service_description:'Service',target_population:'People',evidence_ordinals:[1],population_verified:true,social_service_verified:true};
test('references are bound to eligible codes and final scores determine principal',()=>{
 const result=validateAnalysis(normalizeCandidates(base,all,1),all,1);assert.deepEqual(result.candidates.map(c=>[c.code,c.legal_reference]),[['1.2','official 1.2'],['1.1','official 1.1']]);assert.equal(base.candidates[0].legal_reference,'model text');
});
test('incompatible candidate does not invalidate compatible alternatives',()=>{const result=normalizeCandidates({...base,candidates:[candidate('1.1',.9,false),candidate('1.2',.7)]},all,1);assert.deepEqual(result.candidates.map(c=>c.code),['1.2']);});
test('missing scope or no compatible candidates yields uncertainty, never outside portfolio',()=>{for(const value of [{...base,population_verified:false},{...base,candidates:[candidate('1.1',.9,false)]}]){const result=validateAnalysis(normalizeCandidates(value,all,1),all,1);assert.equal(result.classification,'insufficient_evidence');assert.deepEqual(result.candidates,[]);}});
test('normalization cannot hide parents, economic leaves, unknown codes or invalid evidence',()=>{for(const c of [candidate('1',.9,false),candidate('2',.9,false),candidate('9',.9,false),{...candidate('1.1',.9,false),evidence_ordinals:[2]}])assert.throws(()=>normalizeCandidates({...base,candidates:[c]},all,1));});
test('repair is restricted to incomplete nonpositive conclusions',()=>{
 assert.equal(needsContractRepair(base),false);
 assert.equal(needsContractRepair({...base,classification:'discarded',candidates:[]}),true);
 assert.equal(needsContractRepair({...base,classification:'insufficient_evidence',candidates:[],evidence_ordinals:[]}),true);
 assert.equal(needsContractRepair({...base,classification:'insufficient_evidence',candidates:[]}),false);
 assert.deepEqual(contractRepairSchema(2).properties.classification.enum,['discarded','insufficient_evidence']);
});

test('explicitly incompatible alternatives need no positive evidence ordinal',()=>{const result=normalizeCandidates({...base,candidates:[{...candidate('1.1',.9,false),evidence_ordinals:[]},candidate('1.2',.7)]},all,1);assert.deepEqual(result.candidates.map(c=>c.code),['1.2']);});
