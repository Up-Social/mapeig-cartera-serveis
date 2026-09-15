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
