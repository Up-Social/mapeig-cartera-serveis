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
 const s=conveniSchema([{service_code:'1.1',service_name:'Servei sintètic'},{service_code:'1.2',service_name:'Altres serveis'}],['Q1','Q2']);
 assert.deepEqual(evidence(s,'actors').items.enum,['Q1','Q2']);
 assert.equal(evidence(s,'units').minItems,1);
 const unit=s.properties.units as {items:{properties:{service_ref:{anyOf:Array<{enum?:string[]}>}}}};
 assert.deepEqual(unit.items.properties.service_ref.anyOf[0].enum,['1.1 · Servei sintètic','1.2 · Altres serveis']);
 assert.ok(evidence(conveniSchema([{service_code:'1.1',service_name:'Servei sintètic'}]),'actors').items.properties?.document_id);
});

test('text outside marked pages and duplicate page numbers cannot be silently omitted or assigned a false page',()=>{
 for(const text of ['Contingut sense pàgina acreditada.\n'+doc.extracted_text,'## Pàgina 1\n\nPrimera part amb contingut acreditat.\n\n## Pàgina 1\n\nSegona part amb contingut acreditat.']){
  assert.throws(()=>indexConveniCitations([{...doc,extracted_text:text}]),/CONVENI_PAGE_COVERAGE_UNCERTAIN/);
  const quote=text.includes('Primera part')?'Primera part amb contingut acreditat.':doc.extracted_text.match(/## Pàgina 1\s*\n([^\n]+)/)?.[1];
  assert.ok(quote);
  assert.equal(validCitation({document_id:doc.id,page:1,quote},[{...doc,extracted_text:text}]),false);
 }
});

test('a short substantive page cannot reach the provider without a usable citation',()=>{
 for(const extracted_text of ['## Pàgina 1\n\n10.000,00 €','## Pàgina 1\n\n'])
  assert.throws(()=>indexConveniCitations([{...doc,extracted_text}]),/CONVENI_PAGE_COVERAGE_UNCERTAIN/);
});

test('unmarked PDFs do not invent page 1 without complete single-page coverage',()=>{
 const text='Text documental sintètic que acredita una prestació de servei.';
 const pdf={...doc,mime_type:'application/pdf',extraction_method:'pdftotext',extracted_text:text};
 for(const extraction_coverage of [null,{complete:false,pages:[{page:1}]},{complete:true,pages:[{page:1},{page:2}]},{complete:true,pages:[{page:2}]}]){
  const d={...pdf,extraction_coverage};
  assert.throws(()=>indexConveniCitations([d]),/CONVENI_PAGE_COVERAGE_UNCERTAIN/);
  assert.equal(validCitation({document_id:d.id,page:1,quote:text},[d]),false);
 }
 const single={...pdf,extraction_coverage:{complete:true,pages:[{page:1}]}};
 assert.equal(indexConveniCitations([single]).spans[0].page,1);
 assert.equal(validCitation({document_id:single.id,page:1,quote:text},[single]),true);
 const html={...pdf,mime_type:'text/html',extraction_method:'html-basic'};
 assert.equal(indexConveniCitations([html]).spans[0].page,1);
 const unknown={...pdf,mime_type:null,extraction_method:null};
 assert.throws(()=>indexConveniCitations([unknown]),/CONVENI_PAGE_COVERAGE_UNCERTAIN/);
 assert.equal(validCitation({document_id:unknown.id,page:1,quote:text},[unknown]),false);
});

test('citation boundaries preserve surrogate pairs and merge a short tail without losing text',()=>{
 for(const tailLength of [11,12,30,740]){
  const page='a'.repeat(699)+'😀'+'b'.repeat(tailLength);
  const d={...doc,extracted_text:'## Pàgina 1\n\n'+page};
  const x=indexConveniCitations([d]);
  assert.equal(x.spans.map(span=>span.quote).join(''),page);
  assert.ok(x.spans.every(span=>validCitation(span,[d])));
  for(const span of x.spans){
   assert.doesNotMatch(span.quote,/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
   assert.doesNotMatch(span.quote,/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
   assert.equal(JSON.parse(JSON.stringify(span.quote)),span.quote);
  }
 }
});

test('a short footer fragment joins its neighbour on the same page instead of blocking the conveni',()=>{
 const body='Text literal del conveni amb pactes i obligacions de les parts signants.\n'.repeat(9);
 for(const footer of ['pág. 1','2/25','3','Pàgina 4']){
  const d={...doc,extracted_text:`## Pàgina 1\n\n${body}${'\n'.repeat(4)}${footer}\n\n## Pàgina 2\n\n${footer}\n\n${body}`};
  const x=indexConveniCitations([d]);
  assert.ok(x.spans.every(span=>span.quote.length>=12&&validCitation(span,[d])));
  assert.ok(x.spans.some(span=>span.page===1&&span.quote.endsWith(footer)),footer);
  assert.ok(x.spans.some(span=>span.page===2&&span.quote.startsWith(footer)),footer);
 }
 // A page with only its number is not citable and is skipped; other short content still blocks.
 const numbered={...doc,extracted_text:`## Pàgina 1\n\n${body}\n\n## Pàgina 2\n\n2\n`};
 assert.ok(indexConveniCitations([numbered]).spans.every(span=>span.page===1));
 assert.throws(()=>indexConveniCitations([{...doc,extracted_text:`## Pàgina 1\n\n${body}\n\n## Pàgina 2\n\n10.000,00 €\n`}]),/CONVENI_PAGE_COVERAGE_UNCERTAIN/);
});
