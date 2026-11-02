import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProvisionCard} from '../app/catalog/catalog-workbench';
import {catalogProvisionPage,catalogSourceFinancingType} from '../lib/catalog-source';
import type {ServiceProvision} from '../lib/catalog-types';

const base:ServiceProvision={id:'synthetic',sourceId:'synthetic-source',callUrl:null,regulatoryBasisUrl:null,providerName:'Entitat sintètica',providerNif:null,mechanism:'Concert',awardDate:null,amount:0,contractingBody:null,targetPopulation:'Persones destinatàries del cas sintètic',sourceReference:'Font sintètica'};
const render=(provision:ServiceProvision)=>renderToStaticMarkup(createElement(ProvisionCard,{provision}));
const notice='Aquest text pot descriure l’expedient en conjunt; no acredita per si sol la seva atribució a cada línia del concert.';

test('optional source embedding falls back only for its own schema incompatibility',async()=>{
 const data=[{id:'synthetic',amount:0,target_population:'Població conservada'}];
 for(const error of [{code:'PGRST200',message:'relationship source_records not found'},{code:'PGRST201',details:'ambiguous source_records relationship'},{code:'42703',message:'source_records.financing_type does not exist'}]){
  const calls:boolean[]=[];
  const result=await catalogProvisionPage(async withSource=>{calls.push(withSource);return withSource?{data:null,error}:{data,error:null};});
  assert.deepEqual(calls,[true,false]);assert.strictEqual(result.data,data);
 }
 for(const error of [{code:'42501',message:'permission denied'},{code:'PGRST200',message:'another relationship is missing'},{code:'42703',message:'amount missing'}]){
  let calls=0;const result=await catalogProvisionPage(async()=>{calls++;return {data:null,error};});assert.strictEqual(result.error,error);assert.equal(calls,1);
 }
 const failure={code:'42501',message:'fallback permission denied'};
 const result=await catalogProvisionPage(async withSource=>({data:null,error:withSource?{code:'PGRST200',message:'source_records missing'}:failure}));assert.strictEqual(result.error,failure);
 let calls=0;await catalogProvisionPage(async()=>{calls++;return {data,error:null};});assert.equal(calls,1);
});

test('only an explicit unambiguous source relationship supplies the financing type',()=>{
 for(const financing_type of ['concert','conveni','contractacio','subvencio'] as const){
  assert.equal(catalogSourceFinancingType({financing_type}),financing_type);
  assert.equal(catalogSourceFinancingType([{financing_type}]),financing_type);
 }
 for(const relation of [null,undefined,[],{},'concert',{mechanism:'Concert'},{financing_type:'Concert'},[{financing_type:'concert'},{financing_type:'conveni'}]])assert.equal(catalogSourceFinancingType(relation),null);
});
test('Concert population has an adjacent scope caveat without changing values or claiming review status',()=>{
 const provision={...base,financingType:catalogSourceFinancingType({financing_type:'concert'})};
 const before=JSON.stringify(provision),html=render(provision);
 assert.ok(html.includes(notice));assert.ok(html.includes(base.targetPopulation!));assert.match(html,/0,00/);
 assert.match(html,/Persones destinatàries del cas sintètic<p[^>]*>Aquest text/);
 assert.doesNotMatch(html,/validada|validació|no consta|Pendent de revisió/);
 assert.equal(JSON.stringify(provision),before);
});
test('other types and missing source relationships retain their presentation even with a Concert mechanism',()=>{
 for(const financingType of ['conveni','contractacio','subvencio',null,undefined] as const){
  const html=render({...base,financingType});assert.ok(!html.includes(notice));assert.ok(html.includes(base.targetPopulation!));assert.match(html,/0,00/);
 }
});
test('empty population has no inferred review state; long text and null amounts remain intact',()=>{
 for(const targetPopulation of [null,'','  \n ']){const html=render({...base,financingType:'concert',targetPopulation});assert.ok(!html.includes(notice));}
 const targetPopulation='Descripció sintètica extensa. '.repeat(40);
 const html=render({...base,financingType:'concert',targetPopulation,amount:null});
 assert.ok(html.includes(targetPopulation));assert.ok(html.includes(notice));assert.match(html,/No informat/);assert.doesNotMatch(html,/line-clamp|truncate/);
});
