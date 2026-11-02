import test from 'node:test';
import assert from 'node:assert/strict';
import {extractColumnAnnexRows,extractColumnServiceObservations,extractColumnManagerObservations} from '../lib/concerts/annex-extraction';
import {concertDocumentaryFacts,concertSignedAuthority,concertMaximumPeriod} from '../lib/concerts/documentary-facts';
import type {SourceRecord} from '../lib/workbench-types';
import {createHash} from 'node:crypto';
import {projectConcertEnrichment} from '../lib/cloud/concert-enrichment';
import type {CloudDb} from '../lib/cloud/context';
import type {Enrichment} from '../lib/pipeline/enrichment-contract';
import {validateScopeFacts} from '../lib/normative-matching';

const sha='a'.repeat(64);
const names=[
 'Servei ocupacional STO per a persones amb discapacitat intel·lectual',
 'Servei ocupacional SOI per a persones amb discapacitat intel·lectual',
 'Servei ocupacional STO per a persones amb discapacitat física',
 'Servei ocupacional STO per a persones amb discapacitat física amb auxiliar',
];
const codes=['1.2.6.2.4.1','1.2.6.2.4.2','1.2.6.3.4.1','1.2.6.3.4.1.2'];
const header='Nom entitat'.padEnd(25)+'NIF entitat'.padEnd(16)+'Codi cartera'.padEnd(15)+'Tipologia servei'.padEnd(110)+'Suport'.padEnd(9)+'Codi S'.padEnd(9)+'Nom servei'.padEnd(25)+'Municipi'.padEnd(20)+'IVA'.padEnd(6)+'assignar'.padEnd(10)+'Cost';
const line=(index:number)=>'Entitat sintètica'.padEnd(25)+'G12345678'.padEnd(16)+codes[index%4].padEnd(15)+names[index%4].padEnd(110)+'STOI'.padEnd(9)+`S${String(10000+index)}`.padEnd(9)+'Servei'.padEnd(25)+'Municipi'.padEnd(20)+'0%'.padEnd(6)+'1'.padEnd(10)+'10,00 €';
const text=['## Pàgina 1','Títol genèric que també esmenta CAE i només discapacitat intel·lectual.','## Pàgina 3','La Consellera de Drets Socials i Inclusió','Signat electrònicament','## Pàgina 4','Cost exempt IVA',header,...Array.from({length:7},(_,index)=>line(index)),'Total general 7'].join('\n');
function fixture(source=text){
 const parsed=extractColumnAnnexRows(source);
 assert.equal(parsed.length,7);assert.ok(parsed.every(row=>row.amountCents===1000));
 const units=parsed.map(row=>({id:`unit-${row.row}`,unit_key:`official-annex:${sha}:0:${row.row}`,document_id:'doc',storage_sha256:sha,page:row.page,provider_nif:row.nif,reses_code:row.resesCode,observed_service_code:row.observedServiceCode,quantity:row.quantity,amount:10,evidence_quote:row.quote,act_type:'award'}));
 const reports=[{document_id:'doc',document_sha256:sha,annex:0,row_count:7,sum_cents:7000,reconciled:true}];
 const record={financingType:'concert',isHistorical:false,analysis:{rules_version:'concert-reconciled-annex-v1'},sourceDocuments:[{id:'doc',revision:`${sha}:00000000-0000-4000-8000-000000000001`,currentTextConsistent:true,archived:true,status:'fetched',extractedText:source,extractionMethod:'pdf-text',extractionCoverage:{complete:true},mimeType:'application/pdf',extractionPartial:false,qualityFlags:[]}]} as unknown as Pick<SourceRecord,'financingType'|'isHistorical'|'analysis'|'sourceDocuments'>;
 return {record,units,reports};
}

test('seven anchored annex lines produce four literal services, both populations and the signer, without CAE from the title',()=>{
 const f=fixture(),before=JSON.stringify(f);
 const result=concertDocumentaryFacts(f.record,f.units,f.reports)!;
 assert.ok(result);assert.equal(result.lineCount,7);assert.equal(result.services.length,4);
 assert.deepEqual(result.services.map(service=>service.value),names);
 assert.deepEqual(result.populations,['persones amb discapacitat intel·lectual','persones amb discapacitat física']);
 assert.deepEqual(result.authority,{value:'La Consellera de Drets Socials i Inclusió',page:3});
 assert.doesNotMatch(result.summary,/CAE/);assert.doesNotMatch(JSON.stringify(result),/Girona/);
 assert.equal(JSON.stringify(f),before,'projection must not change monetary rows or records');
});

test('an absent population remains pending without borrowing it from other lines or discarding their documentary facts',()=>{
 const f=fixture(text.replace(names[0],'Servei sense destinataris indicats'.padEnd(names[0].length)));
 const result=concertDocumentaryFacts(f.record,f.units,f.reports);
 assert.ok(result);assert.equal(result.lineCount,7);assert.equal(result.populations,null);
});

test('service observations retain original row keys and source pages',()=>{
 const before=extractColumnAnnexRows(text);const cells=extractColumnServiceObservations(text);
 assert.equal(cells.length,7);assert.deepEqual(cells.map(cell=>cell.row),[1,2,3,4,5,6,7]);
 assert.deepEqual(extractColumnAnnexRows(text),before);
});

test('the management centre is only a literal aligned code, without a territory inference',()=>{
 const source=['## Pàgina 4','Centre','gestor'.padEnd(12)+'FUE'.padEnd(20)+header,'BE2191',...Array.from({length:7},(_,index)=>' '.repeat(32)+line(index)),'Total general 7'].join('\n');
 assert.deepEqual(extractColumnManagerObservations(source),[{value:'BE2191',page:4}]);
 assert.deepEqual(extractColumnManagerObservations(source.replace('Centre','Altres')),[]);
 assert.deepEqual(extractColumnManagerObservations(source.replace('\nBE2191\n','\nReferència BE2191\n')),[]);
});

test('changed SHA, invalid text hash metadata and incomplete or corrupt extraction suppress the projection',()=>{
 const changes=[{revision:`${'b'.repeat(64)}:extraction`},{currentTextConsistent:false},{archived:false},{extractionPartial:true},{extractionCoverage:{complete:false}},{qualityFlags:['corrupt_text']},{mimeType:'text/html'}];
 for(const change of changes){const f=fixture();Object.assign(f.record.sourceDocuments[0],change);assert.equal(concertDocumentaryFacts(f.record,f.units,f.reports),null,JSON.stringify(change));}
});

test('missing, duplicate, changed and unreconciled rows cannot generate a complete annex summary',()=>{
 const missing=fixture();missing.units.pop();assert.equal(concertDocumentaryFacts(missing.record,missing.units,missing.reports),null);
 const duplicate=fixture();duplicate.units[1]={...duplicate.units[0],id:'duplicate'};assert.equal(concertDocumentaryFacts(duplicate.record,duplicate.units,duplicate.reports),null);
 const altered=fixture();altered.units[0].provider_nif='G87654321';assert.equal(concertDocumentaryFacts(altered.record,altered.units,altered.reports),null);
 const unreconciled=fixture();unreconciled.reports[0].reconciled=false;assert.equal(concertDocumentaryFacts(unreconciled.record,unreconciled.units,unreconciled.reports),null);
 const stale=fixture();const units=stale.units.map((unit,index)=>({...unit,observation:{pendingRevision:index===0}}));assert.equal(concertDocumentaryFacts(stale.record,units,stale.reports),null);
});

test('historical records and other financing types do not receive a Concert projection',()=>{
 const historical=fixture();historical.record.isHistorical=true;assert.equal(concertDocumentaryFacts(historical.record,historical.units,historical.reports),null);
 const other=fixture();other.record.financingType='conveni';assert.equal(concertDocumentaryFacts(other.record,other.units,other.reports),null);
});

test('recitals, unrelated actor names and ambiguous signatures never identify the issuing authority',()=>{
 assert.equal(concertSignedAuthority('## Pàgina 1\nLa Consellera de Drets Socials i Inclusió va informar en un altre expedient.'),null);
 assert.equal(concertSignedAuthority(text+'\n## Pàgina 5\nEl President del Consorci\nSignat electrònicament'),null);
 assert.equal(concertSignedAuthority('La Consellera de Drets Socials i Inclusió\nSignat electrònicament'),null,'a page is required for the observation');
});

test('the maximum period is a page-bound literal with its reduction condition, never line dates',()=>{
 const clause="## Pàgina 2\nRESOLC: 2. Indicar l’import, amb efectes econòmics pel període comprès entre l’1 de febrer de 2025 i el 31 de desembre de 2025, ambdós inclosos, per un import total màxim de 70,00 euros, exempt d’IVA, tal com s’indica a l’Annex d’aquesta resolució. En cas que l'assignació es resolgui després de l'1 de febrer de 2025, aquest import es reduirà proporcionalment i s'adaptarà al nou termini de prestació del servei.";
 const result=concertMaximumPeriod(clause,7000);
 assert.equal(result?.page,2);assert.match(result!.quote,/l’1 de febrer de 2025 i el 31 de desembre de 2025/);
 assert.match(result!.condition!,/reduirà proporcionalment/);assert.equal(Object.hasOwn(result!,'effective_start'),false);
 assert.equal(concertMaximumPeriod(clause,6000),null);
 assert.equal(concertMaximumPeriod(clause.replace('RESOLC:','Fets:'),7000),null);
 assert.equal(concertMaximumPeriod(clause+'\n'+clause.replace('Pàgina 2','Pàgina 3'),7000),null);
});

test('Concert enrichment persists documentary summary, population and signer with citations, preserving model roles and money',async()=>{
 const f=fixture(),recordId='record';
 const rawDocument={id:'doc',source_record_id:recordId,url:'https://example.test/doc.pdf',document_type:'resolution',status:'fetched',mime_type:'application/pdf',storage_path:'immutable.pdf',storage_sha256:sha,active_extraction_id:'00000000-0000-4000-8000-000000000001',extracted_text:text,extracted_text_hash:createHash('sha256').update(text).digest('hex'),extraction_method:'pdf-text',extraction_partial:false,extraction_coverage:{complete:true},quality_flags:[]};
 const tables:Record<string,Array<Record<string,unknown>>>={source_documents:[rawDocument],record_units:f.units.map(unit=>({...unit,source_record_id:recordId})),concert_annex_reconciliations:f.reports.map(report=>({...report,source_record_id:recordId})),current_evidence_chunks:[{id:'chunk',source_document_id:'doc',ordinal:0,content:text}]};
 class Query{
  filters:Array<(row:Record<string,unknown>)=>boolean>=[];start=0;end=Infinity;
  constructor(private table:string){}
  select(){return this;}eq(key:string,value:unknown){this.filters.push(row=>row[key]===value);return this;}
  neq(key:string,value:unknown){this.filters.push(row=>row[key]!==value);return this;}
  in(key:string,values:unknown[]){this.filters.push(row=>values.includes(row[key]));return this;}
  order(){return this;}range(from:number,to:number){this.start=from;this.end=to;return this;}
  rows(){return tables[this.table].filter(row=>this.filters.every(filter=>filter(row))).slice(this.start,this.end+1);}
  async maybeSingle(){return {data:this.rows()[0]??null,error:null};}
  then(resolve:(result:unknown)=>unknown,reject:(error:unknown)=>unknown){return Promise.resolve({data:this.rows(),error:null}).then(resolve,reject);}
 }
 const db={from:(table:string)=>new Query(table)} as unknown as CloudDb;
 const emptyFact={value:null,evidence_ordinals:[]};
 const original:Enrichment={title:'Títol amb CAE',summary:'Text general amb CAE',target_population:'Només discapacitat intel·lectual',contracting_body:'Departament genèric',provider_name:'Entitat model',provider_nif:'G12345678',mechanism:'Concert',award_date:'2025-06-06',amount:70,confidence:0.9,evidence_ordinals:[1],scope_facts:{financed_object:emptyFact,funding_recipient:emptyFact,final_recipient:emptyFact,administrative_role:emptyFact}};
 const before=JSON.stringify(original),result=await projectConcertEnrichment(db,recordId,original);
 assert.match(result.enrichment.target_population!,/intel·lectual.*física/);assert.doesNotMatch(result.enrichment.summary,/CAE/);
 assert.equal(result.enrichment.contracting_body,'La Consellera de Drets Socials i Inclusió');
 for(const field of ['provider_name','provider_nif','mechanism','award_date','amount','confidence','evidence_ordinals'] as const)assert.deepEqual(result.enrichment[field],original[field]);
 validateScopeFacts(result.enrichment.scope_facts,1);
 const provenance=(result.enrichment.scope_facts as typeof original.scope_facts&{documentary_projection:{document_sha256:string;fields:{contracting_body:{page:number}}}}).documentary_projection;
 assert.equal(provenance.document_sha256,sha);assert.equal(provenance.fields.contracting_body.page,3);
 assert.equal(result.evidence[0].id,'chunk');assert.equal(JSON.stringify(original),before);
 rawDocument.extracted_text=text+'\n## Pàgina 6\nEl President del Consorci\nSignat electrònicament';
 rawDocument.extracted_text_hash=createHash('sha256').update(rawDocument.extracted_text).digest('hex');
 const ambiguous=await projectConcertEnrichment(db,recordId,original);
 assert.equal(ambiguous.enrichment.contracting_body,original.contracting_body,'an unsupported signer must not erase the stored value');
 const metadata=(ambiguous.enrichment.scope_facts as typeof original.scope_facts&{documentary_projection:{applied_fields:string[];fields:{contracting_body:unknown}}}).documentary_projection;
 assert.equal(metadata.fields.contracting_body,null);assert.equal(metadata.applied_fields.includes('contracting_body'),false);
 rawDocument.extracted_text_hash='b'.repeat(64);
 const stale=await projectConcertEnrichment(db,recordId,original);assert.equal(stale.enrichment,original);assert.deepEqual(stale.evidence,[]);
});
