import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {projectConcertEnrichment} from '../lib/cloud/concert-enrichment';
import type {CloudDb} from '../lib/cloud/context';
import type {Enrichment} from '../lib/pipeline/enrichment-contract';

const title='Acord proposta per a la provisió de serveis socials de prova en una ciutat fictícia';
const text=`## Pàgina 1\n${title}\nPROPOSA\nProposar els serveis.\n## Pàgina 2\nANNEX 1. SERVEIS ASSIGNATS\n1.- Servei fictici Alfa en règim de concert social\nsense IVA amb IVA (10%)\nImport total 179.869,02 euros 197.855,92 euros\n2.- Servei fictici Beta en règim de gestió delegada\nsense IVA amb IVA (10%)\nImport total 107.392,11 euros 118.131,32 euros\n## Pàgina 3\nANNEX 2. ALTRES DADES`;
const doc={id:'doc',source_record_id:'record',status:'fetched',mime_type:'application/pdf',storage_path:'source.pdf',storage_sha256:'a'.repeat(64),active_extraction_id:'00000000-0000-4000-8000-000000000001',extracted_text:text,extracted_text_hash:createHash('sha256').update(text).digest('hex'),extraction_method:'pdf-text-markdown-v2',extraction_partial:false,extraction_coverage:{complete:true},quality_flags:[] as string[]};
const fact={value:null,evidence_ordinals:[]};
const original:Enrichment={title,summary:'L’import total estimat és 316.546,03 euros.',target_population:null,contracting_body:null,provider_name:null,provider_nif:null,mechanism:'Concert',award_date:null,amount:316546.03,confidence:0.9,evidence_ordinals:[1],scope_facts:{financed_object:fact,funding_recipient:fact,final_recipient:fact,administrative_role:fact}};
function fakeDb(document=doc){
 const tables:Record<string,Array<Record<string,unknown>>>={source_records:[{id:'record',title}],source_documents:[document],concert_annex_reconciliations:[],current_evidence_chunks:[{id:'one',source_document_id:'doc',ordinal:1,content:'Import total 179.869,02 euros 197.855,92 euros'},{id:'two',source_document_id:'doc',ordinal:2,content:'Import total 107.392,11 euros 118.131,32 euros'}]};
 class Query{filters:Array<(r:Record<string,unknown>)=>boolean>=[];from=0;to=Infinity;constructor(private table:string){}select(){return this;}eq(key:string,v:unknown){this.filters.push(r=>r[key]===v);return this;}in(key:string,v:unknown[]){this.filters.push(r=>v.includes(r[key]));return this;}order(){return this;}range(a:number,b:number){this.from=a;this.to=b;return this;}rows(){return tables[this.table].filter(r=>this.filters.every(f=>f(r))).slice(this.from,this.to+1);}async maybeSingle(){return {data:this.rows()[0]??null,error:null};}then(resolve:(x:unknown)=>unknown,reject:(x:unknown)=>unknown){return Promise.resolve({data:this.rows(),error:null}).then(resolve,reject);}}
 return {from:(table:string)=>new Query(table)} as unknown as CloudDb;
}
test('a proposal saves source totals separately, clears the unverified global amount and retains the model output',async()=>{
 const result=await projectConcertEnrichment(fakeDb(),'record',original);
 assert.equal(result.enrichment.amount,null);assert.match(result.enrichment.summary,/Proposta provisional/);
 const metadata=(result.enrichment.scope_facts as Record<string,unknown>).provisional_document_amounts as {total_cents:number;original_model_amount:number;rows:unknown[]};
 assert.equal(metadata.total_cents,31598724);assert.equal(metadata.original_model_amount,316546.03);assert.equal(metadata.rows.length,2);
 assert.equal(result.evidence.length,2);assert.equal(original.amount,316546.03);
});
test('an invalid source hash or partial extraction cannot change a proposal',async()=>{
 for(const changed of [{...doc,extracted_text_hash:'b'.repeat(64)},{...doc,extraction_partial:true},{...doc,quality_flags:['corrupt_text']}])
  assert.equal((await projectConcertEnrichment(fakeDb(changed),'record',original)).enrichment,original);
});
