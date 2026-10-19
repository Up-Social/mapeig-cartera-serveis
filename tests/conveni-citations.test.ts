import test from 'node:test';import assert from 'node:assert/strict';
import {indexConveniCitations,resolveConveniCitations} from '../lib/convenis/citations';
import {validCitation} from '../lib/convenis/contract';
import {conveniSchema} from '../lib/convenis/process';
const doc={id:'document-real',storage_sha256:'a'.repeat(64),extracted_text:'## Pàgina 5\n\nPrimera part de la taula: aportació 1.000 €.\n\n## Pàgina 6\n\nContinuació literal de la taula amb noms i NIF.'};
test('citation index retains literal table continuations and physical pages',()=>{const x=indexConveniCitations([doc]);assert.equal(x.spans.length,2);assert.deepEqual(x.spans.map(s=>s.page),[5,6]);assert.ok(x.spans.every(s=>validCitation(s,[doc])));assert.ok(x.documents[0].extracted_text.includes('[Q2]'));});
test('long evidence is sliced contiguously, including a short final tail',()=>{const d={...doc,extracted_text:'## Pàgina 1\n\n'+('text literal amb espais i noms\n'.repeat(90))+'final'};const x=indexConveniCitations([d]);assert.ok(x.spans.length>1);assert.ok(x.spans.every(s=>validCitation(s,[d])));assert.ok(x.spans.at(-1)!.quote.endsWith('final'));});
test('citation selection resolves source facts without accepting fabricated UUIDs or prose',()=>{const {spans}=indexConveniCitations([doc]);const input={actors:[{evidence:['Q1']}],units:[{evidence:['Q2']}]};const out=resolveConveniCitations(input,spans);assert.equal(out.actors[0].evidence[0].document_id,doc.id);assert.equal(out.units[0].evidence[0].page,6);assert.deepEqual(input.actors[0].evidence,['Q1']);for(const id of ['Q999','invented UUID',{document_id:'fake',quote:'text'}])assert.throws(()=>resolveConveniCitations({actors:[{evidence:[id]}],units:[]},spans));});
test('schema constrains evidence to supplied span IDs while old schema remains compatible',()=>{
 type Evidence={minItems?:number;items:{enum?:string[];properties?:Record<string,unknown>}};
 const evidence=(s:ReturnType<typeof conveniSchema>,kind:string)=>(s.properties[kind] as {items:{properties:{evidence:Evidence}}}).items.properties.evidence;
 const s=conveniSchema([{service_code:'1.1',service_name:'Servei sintètic'}],['Q1','Q2']);
 assert.deepEqual(evidence(s,'actors').items.enum,['Q1','Q2']);
 assert.equal(evidence(s,'units').minItems,1);
 assert.ok(evidence(conveniSchema([{service_code:'1.1',service_name:'Servei sintètic'}]),'actors').items.properties?.document_id);
});
