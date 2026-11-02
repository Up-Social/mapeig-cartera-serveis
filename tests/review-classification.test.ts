import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewClassificationLabel} from '../lib/review-classification';
import type {StoredAnalysis} from '../lib/analysis-contract';
test('review list distinguishes each normative classification from human approval',()=>{
 for(const [classification,label] of Object.entries({in_portfolio:'En cartera',out_of_portfolio:'Fora de cartera',discarded:'Descartat',insufficient_evidence:'Evidència insuficient'})){
  assert.equal(reviewClassificationLabel({analysis:{classification} as StoredAnalysis,status:'revisio'}),label);
 }
 assert.equal(reviewClassificationLabel({analysis:{classification:'in_portfolio',reviewed_classification:'discarded'} as StoredAnalysis,status:'rebutjat'}),'Descartat');
});
test('legacy and pending results do not invent normative classifications',()=>{
 assert.equal(reviewClassificationLabel({status:'revisio'}),'Sense classificació normativa');
 assert.equal(reviewClassificationLabel({status:'preparant'}),'Actualitzant classificació');
 assert.equal(reviewClassificationLabel({status:'error'}),'Classificació interrompuda');
});
test('invalidated results are never presented as a valid portfolio classification',()=>{
 assert.equal(reviewClassificationLabel({analysis:{classification:'in_portfolio',reliability_status:'invalidated'} as StoredAnalysis,status:'revisio'}),'Resultat no fiable');
});
test('a conveni review container is not a global insufficient classification',()=>{
 const analysis={id:'a',classification:'insufficient_evidence',reasons:[],explanation:'Propostes per receptor',service_description:'',target_population:'',catalog_version_id:'v',rules_version:'convenis-sprint2-v1',reviewed_classification:null,review_notes:null,evidence:[],rule_audit:{rule:'review_by_recipient'}} as StoredAnalysis;
 assert.equal(reviewClassificationLabel({analysis,status:'revisio'}),'Revisió per unitat');
 assert.equal(reviewClassificationLabel({analysis:{...analysis,reliability_status:'invalidated'},status:'revisio'}),'Resultat no fiable');
});
