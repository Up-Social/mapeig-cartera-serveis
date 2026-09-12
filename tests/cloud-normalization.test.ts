import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMissingScope} from '../lib/cloud/normalize-analysis';
import type {AnalysisOutput} from '../lib/analysis-contract';
const base:AnalysisOutput={classification:'out_of_portfolio',candidates:[],reasons:[],explanation:'Un servei pendent de comprovació documental.',service_description:'Servei',target_population:'',evidence_ordinals:[1],population_verified:false,social_service_verified:true};
test('Missing scope cannot become a negative catalog conclusion',()=>{const r=normalizeMissingScope(base);assert.equal(r.classification,'insufficient_evidence');assert.deepEqual(r.evidence_ordinals,[1]);assert.equal(base.classification,'out_of_portfolio');});
test('Confirmed scope retains the catalog conclusion',()=>{assert.equal(normalizeMissingScope({...base,population_verified:true}).classification,'out_of_portfolio');});
test('Invalid candidates are left for strict rejection, never replaced',()=>{const value={...base,classification:'in_portfolio' as const,candidates:[{code:'1',score:1,rationale:'',evidence_ordinals:[1],evidence_explanation:'',population_compatible:false,legal_reference:''}]};assert.equal(normalizeMissingScope(value),value);});
