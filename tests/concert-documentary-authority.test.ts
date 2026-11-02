import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {projectConcertEnrichment} from '../lib/cloud/concert-enrichment';
import {currentDocumentaryAuthority} from '../lib/concerts/documentary-authority';
import type {CloudDb} from '../lib/cloud/context';
import type {Enrichment} from '../lib/pipeline/enrichment-contract';
import type {SourceRecord} from '../lib/workbench-types';

const text=readFileSync('tests/fixtures/official/concert-s1-2-resolution.txt','utf8');
const units=JSON.parse(readFileSync('tests/fixtures/official/concert-s1-2-units.json','utf8')) as Array<Record<string,unknown>>;
const sha='7133efb2816eff8f57e0c830caa5961ef5b2feb93002d1019a74529ccf784d72',id='10f3b05c-ef75-4f65-be1b-d29d6cdf27e5',extraction='00000000-0000-4000-8000-000000000001';
const textHash=createHash('sha256').update(text).digest('hex');
const document={id,url:'https://example.invalid/official.pdf',document_type:'publication',status:'fetched',mime_type:'application/pdf',storage_path:'archived.pdf',storage_sha256:sha,active_extraction_id:extraction,extracted_text:text,extracted_text_hash:textHash,extraction_method:'pdf-text-markdown-v2',extraction_partial:false,extraction_coverage:{complete:true},quality_flags:[] as string[]};
const report={document_id:id,document_sha256:sha,annex:0,row_count:3,sum_cents:1103614,reconciled:true};
const fact={value:null,evidence_ordinals:[]};
const original:Enrichment={title:'Resolució',summary:'Resum inicial',target_population:'Població inicial',contracting_body:'Generalitat de Catalunya',provider_name:null,provider_nif:null,mechanism:'Concert',award_date:'2025-12-30',amount:11036.14,confidence:0.9,evidence_ordinals:[1],scope_facts:{financed_object:fact,funding_recipient:fact,final_recipient:fact,administrative_role:fact}};
function dbFor(doc=document,rows=units,reports=[report]){
 const tables:Record<string,Array<Record<string,unknown>>>={source_documents:[doc],record_units:rows,concert_annex_reconciliations:reports,current_evidence_chunks:[{id:'chunk',source_document_id:id,ordinal:0,content:text}]};
 class Query{filters:Array<(row:Record<string,unknown>)=>boolean>=[];from=0;to=Infinity;constructor(private table:string){} select(){return this;}eq(key:string,v:unknown){if(key!=='source_record_id')this.filters.push(r=>r[key]===v);return this;}neq(key:string,v:unknown){this.filters.push(r=>r[key]!==v);return this;}in(key:string,v:unknown[]){this.filters.push(r=>v.includes(r[key]));return this;}order(){return this;}range(a:number,b:number){this.from=a;this.to=b;return this;}rows(){return tables[this.table].filter(r=>this.filters.every(f=>f(r))).slice(this.from,this.to+1);}async maybeSingle(){return {data:this.rows()[0]??null,error:null};}then(resolve:(x:unknown)=>unknown,reject:(x:unknown)=>unknown){return Promise.resolve({data:this.rows(),error:null}).then(resolve,reject);}}
 return {from:(table:string)=>new Query(table)} as unknown as CloudDb;
}
test('S1-2 keeps summary and population while persisting the signed authority and manager',async()=>{
 const result=await projectConcertEnrichment(dbFor(),'record',original);
 assert.equal(result.enrichment.summary,original.summary);assert.equal(result.enrichment.target_population,original.target_population);
 assert.equal(result.enrichment.amount,original.amount);assert.equal(result.enrichment.contracting_body,'La Consellera de Drets Socials i Inclusió');
 const metadata=(result.enrichment.scope_facts as Record<string,unknown>).documentary_authority as Record<string,unknown>;
 assert.deepEqual(metadata.manager_codes,[{page:4,value:'BE2192'}]);assert.equal(result.evidence.length,1);
 const record={financingType:'concert',isHistorical:false,externalEnrichment:{documentaryAuthority:metadata},sourceDocuments:[{id,revision:`${sha}:${extraction}`,extractedTextHash:textHash,currentTextConsistent:true,archived:true,status:'fetched',extractedText:text,mimeType:'application/pdf',extractionMethod:'pdf-text-markdown-v2',extractionPartial:false,extractionCoverage:{complete:true},qualityFlags:[]}]} as unknown as SourceRecord;
 assert.equal(currentDocumentaryAuthority(record)?.authority?.value,'La Consellera de Drets Socials i Inclusió');
 assert.deepEqual(currentDocumentaryAuthority(record)?.managerCodes,[{page:4,value:'BE2192'}]);
 assert.equal(currentDocumentaryAuthority({...record,sourceDocuments:[{...record.sourceDocuments[0],extractedTextHash:'b'.repeat(64)}]}),null);
 assert.equal(currentDocumentaryAuthority({...record,isHistorical:true}),null);
});
test('stale source or unreconciled lines never override the model output',async()=>{
 assert.equal((await projectConcertEnrichment(dbFor({...document,extracted_text_hash:'b'.repeat(64)}),'record',original)).enrichment,original);
 assert.equal((await projectConcertEnrichment(dbFor({...document,quality_flags:['corrupt_text']}),'record',original)).enrichment,original);
 assert.equal((await projectConcertEnrichment(dbFor({...document,extraction_partial:true}),'record',original)).enrichment,original);
 assert.equal((await projectConcertEnrichment(dbFor(document,units.slice(0,2)),'record',original)).enrichment,original);
});

test('wrapped program header shows a literal manager code without inferring the signer',async()=>{
 const {programAnnexManagers}=await import('../lib/concerts/documentary-authority');
 const text='## Pàgina 4\nCentre    Nom                 Codi     Tipologia\ngestor    entitat  NIF entitat cartera servei Codi S Nom servei\nBE2193\nTarragona\n';
 assert.deepEqual(programAnnexManagers(text),[{value:'BE2193',page:4}]);
 assert.deepEqual(programAnnexManagers(text.replace('gestor','òrgan')),[]);
 assert.deepEqual(programAnnexManagers(text.replace('BE2193','BE2193 altre text')),[]);
});
