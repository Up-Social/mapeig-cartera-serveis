import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeRecord} from '../lib/cloud/analysis';
import {evidenceRejectionReasons,isEligibleEvidence} from '../lib/evidence-eligibility';
import {hasCurrentTextCoverage} from '../lib/pipeline/document-input';
import {CloudFailure} from '../lib/cloud/errors';
import type {CloudDb} from '../lib/cloud/context';

const raw=(value:unknown)=>({id:'fixture-response',model:'gpt-6-luna',usage:{total_tokens:5},output_text:JSON.stringify(value)});
const insufficient=(overrides:Record<string,unknown>={})=>({classification:'insufficient_evidence',reasons:[],explanation:'La informació documental no acredita el servei ni les persones destinatàries.',service_description:'',target_population:'',evidence_ordinals:[1],population_verified:false,social_service_verified:false,candidates:[],...overrides});
const unknownRole={value:null,state:'contradictory',kind:'unknown',evidence_ordinals:[],quotes:[]};
const reviewRoles={checks:['financed_object','final_population','final_service'].map(role=>({role,state:'unknown',value:null,kind:'unknown',evidence_ordinal:0}))};
const repair=(overrides:Record<string,unknown>={})=>({classification:'insufficient_evidence',reasons:[],explanation:'Cal revisar la documentació per poder identificar la prestació.',evidence_ordinals:[1],...overrides});
class Query {
 private filters:Array<(row:Record<string,unknown>)=>boolean>=[];private start=0;private end=Infinity;private size=Infinity;private orders:string[]=[];
 constructor(private rows:Record<string,unknown>[]){}
 select(fields:string){void fields;return this;} eq(key:string,value:unknown){this.filters.push(r=>r[key]===value);return this;}
 in(key:string,values:unknown[]){this.filters.push(r=>values.includes(r[key]));return this;}
 not(key:string,op:string,value:unknown){if(op!=='is'||value!==null)throw Error('unexpected not');this.filters.push(r=>r[key]!=null);return this;}
 contains(key:string,value:Record<string,unknown>){this.filters.push(r=>Object.entries(value).every(([k,v])=>(r[key] as Record<string,unknown>|null)?.[k]===v));return this;}
 like(key:string,value:string){this.filters.push(r=>String(r[key]??'').startsWith(value.replace(/%.*$/, '')));return this;}
 order(key:string){this.orders.push(key);return this;} range(a:number,b:number){this.start=a;this.end=b;return this;} limit(n:number){this.size=n;return this;}
 private result(){const rows=this.rows.filter(row=>this.filters.every(f=>f(row)));rows.sort((a,b)=>{for(const k of this.orders){if(String(a[k])<String(b[k]))return -1;if(String(a[k])>String(b[k]))return 1;}return 0;});return rows.slice(this.start,Math.min(this.end+1,this.start+this.size));}
 async single(){const rows=this.result();if(rows.length!==1)return {data:null,error:{message:'single mismatch'}};return {data:rows[0],error:null};}
 async maybeSingle(){const rows=this.result();if(rows.length>1)return {data:null,error:{message:'multiple'}};return {data:rows[0]??null,error:null};}
 then(resolve:(x:{data:Record<string,unknown>[];error:null})=>unknown,reject:(e:unknown)=>unknown){return Promise.resolve({data:this.result(),error:null}).then(resolve,reject);}
}
async function fixture(withRoles:boolean,withRepair:boolean,repairDiscard=false,diagnostic=false,outside=false,ineligible=false,expectFence=false){
 const job='job-fixture',sourceId='source-fixture',task='task-fixture';
 const source={id:sourceId,financing_type:'concert',title:'Resolució de provisió de serveis socials',mechanism:'Concert',provider_name:'Entitat de prova',source_payload:{},record_enrichments:{scope_facts:{roles:diagnostic?{financed_object:{value:'fet original documentat',state:'known',kind:'service_financing',evidence_ordinals:[1],quotes:['invalid']},final_population:unknownRole,final_service:unknownRole}:withRoles?{}:{financed_object:unknownRole,final_population:unknownRole,final_service:unknownRole}}}};
 const content='Aquesta és una resolució sintètica que descriu un expedient administratiu i la provisió de serveis. Les dades s’han preparat exclusivament per comprovar el flux de classificació i la seva evidència. En aquest exemple no es coneixen encara les condicions particulars del servei ni la població destinatària. Cal completar la informació documental abans d’adoptar una decisió.';
 const document={id:'doc-fixture',source_record_id:sourceId,document_type:'resolution',status:'fetched',extraction_partial:false,text_length:content.length,extraction_method:'pdf-text',extraction_coverage:{complete:true},mime_type:'application/pdf',quality_flags:[]};
 const evidence={id:'chunk-fixture',source_document_id:document.id,ordinal:0,content};
 const quality={content,textLength:document.text_length,extractionMethod:document.extraction_method,qualityFlags:document.quality_flags,coverageVerified:hasCurrentTextCoverage(document.extraction_method,document.extraction_coverage,document.mime_type,document.extraction_partial)};
 const assessed={...evidence,eligible:isEligibleEvidence(quality),rejection_reasons:evidenceRejectionReasons(quality)};assert.equal(assessed.eligible,true);
 const version={id:'fixture-v1',active:true,validated:true,entry_count:1,general_context:'Context normatiu sintètic',provenance:{}};
 const service={version_id:version.id,service_code:'1',service_name:'Servei social sintètic',parent_code:null,benefit_type:'service',description:'Descripció',target_population:'Persones',conditions:'Condicions',legal_reference:'Llei',normative_fields:{}};
 const checkpoints=new Map<string,unknown>(),requests:Array<{body:Record<string,unknown>;serialized:string;response:Record<string,unknown>}> =[];let saved:unknown;
 const rolesResponse=diagnostic?{checks:[{role:'financed_object',state:'known',value:'un fet diferent',kind:'service_financing',evidence_ordinal:1}]}:reviewRoles;
 const responses=[...(withRoles?[raw(rolesResponse)]:[]),raw(insufficient({...withRepair?{evidence_ordinals:[]}:{} ,...outside?{classification:'out_of_portfolio'}:{},...ineligible?{classification:'in_portfolio',service_description:'Servei social',target_population:'Persones',population_verified:true,social_service_verified:true,candidates:[{code:'1.9',score:1,rationale:'Proposta',evidence_ordinals:[1],evidence_explanation:'Fragment',population_compatible:true,legal_reference:'Llei'}]}:{}})),...(withRepair?[raw(repair(repairDiscard?{classification:'discarded',reasons:['not_social_service']}:{ }))]:[])];
 const tables:Record<string,Record<string,unknown>[]>={source_records:[source],source_documents:[document],current_evidence_chunks:[evidence],current_documented_corrections:[],concert_annex_reconciliations:[],record_units:[],catalog_versions:[version],official_services:[service],app_settings:[{key:'processing_enabled',enabled:true}],cloud_resources:[]};
 const db={from(name:string){if(name==='cloud_checkpoints')return new Query([...checkpoints].map(([item_key,value])=>({task_id:task,item_key,value})));if(!Object.hasOwn(tables,name))throw Error('unexpected table '+name);return new Query(tables[name]);},
  async rpc(name:string,args:Record<string,unknown>){switch(name){case 'cloud_checkpoint':checkpoints.set(String(args.p_key),args.p_value);return {data:true,error:null};case 'cloud_commit':saved=args.p_data;return {data:true,error:null};case 'cloud_resource':case 'cloud_budget_reserve':return {data:true,error:null};case 'cloud_budget_settle':case 'cloud_provider_usage':return {data:true,error:null};default:throw Error('unexpected rpc '+name);}}};
 const originalFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(url!=='https://api.openai.com/v1/responses'||typeof init?.body!=='string')throw Error('UNEXPECTED NETWORK');
  const response=responses.shift();if(!response)throw Error('UNEXPECTED PROVIDER CALL');requests.push({body:JSON.parse(init.body),serialized:init.body,response});
  return new Response(JSON.stringify(response),{status:200,headers:{'content-type':'application/json'}});
 };
 const oldEnv={OPENAI_MATCHING_MODEL:process.env.OPENAI_MATCHING_MODEL,OPENAI_API_KEY:process.env.OPENAI_API_KEY,WORKFLOW_TEST_PROJECT:process.env.WORKFLOW_TEST_PROJECT,PIPELINE_PROVIDER:process.env.PIPELINE_PROVIDER,WORKER_EXECUTION_MODE:process.env.WORKER_EXECUTION_MODE,VERCEL_ENV:process.env.VERCEL_ENV};
 let failure:unknown;let repeatFailure:unknown;
 try{
  process.env.OPENAI_MATCHING_MODEL='gpt-6-luna';process.env.OPENAI_API_KEY='fixture-only';delete process.env.WORKFLOW_TEST_PROJECT;delete process.env.PIPELINE_PROVIDER;process.env.WORKER_EXECUTION_MODE='local';delete process.env.VERCEL_ENV;
  try {await analyzeRecord({db:db as unknown as CloudDb,task,owner:'fixture-owner',generation:1},{id:job,source_record_id:sourceId},'matching');}catch(error){failure=error;}
  try {await analyzeRecord({db:db as unknown as CloudDb,task,owner:'fixture-owner',generation:1},{id:job,source_record_id:sourceId},'matching');}catch(error){repeatFailure=error;}
 }finally{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(oldEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;}
 assert.equal(expectFence,true);
 assert.ok(failure instanceof CloudFailure);assert.equal(failure.kind,'provider_reconciliation');
 assert.equal(failure.diagnostic?.code,'EXISTING_PROVIDER_RECEIPT_REVIEW_REQUIRED');
 assert.ok(repeatFailure instanceof CloudFailure);assert.equal(repeatFailure.kind,'provider_reconciliation');
 assert.equal(saved,undefined);assert.equal(responses.length,0);
 assert.equal((checkpoints.get('ai:job-fixture:matching') as {state?:string})?.state,'received');
 assert.equal((checkpoints.get('ai:job-fixture:contract-repair-v1') as {state?:string})?.state,'received');
 return requests.length;
}
test('Concert repair proposing discard preserves received checkpoints and pauses before commit',async()=>{
 for(const roles of [false,true])assert.equal(await fixture(roles,true,true,false,false,false,true),2+Number(roles));
});
