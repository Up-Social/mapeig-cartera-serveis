import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';

let db:SupabaseClient;
const cases=[
 {id:randomUUID(),doc:randomUUID(),text:'RESOLC: 1. Aprovar la relació de dades administratives.\nAnnex\n2. Assignar places a una entitat.',effect:'none',label:'Títol genèric',forbidden:'possible adjudicació'},
 {id:randomUUID(),doc:randomUUID(),text:'RESOLC: 1. Assignar places a una entitat.\n## Annex\n2. Denegar les places descrites en un antecedent.',effect:'possible_award',label:'possible adjudicació',forbidden:'també 1. Denegació'},
];
test.beforeAll(async()=>{
 const dbProject=execFileSync('docker',['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_cartera-workflow-test'],{encoding:'utf8',timeout:10_000}).trim();
 const apiProject=execFileSync('docker',['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_kong_cartera-workflow-test'],{encoding:'utf8',timeout:10_000}).trim();
 if(dbProject!=='cartera-workflow-test'||apiProject!=='cartera-workflow-test')throw Error('Only the isolated local test project may be used');
 const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
 if(status.API_URL!=='http://127.0.0.1:55421')throw Error('Only the isolated local test database may be used');
 db=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 for(const item of cases){
  const url=`https://fixture.invalid/${item.doc}`;
  const record=await db.from('source_records').insert({id:item.id,source_dataset:'concerts',source_record_id:`SYNTHETIC-E2E-${item.id}`,mechanism:'Concert social / gestió delegada',title:'Resolució de l’expedient: 26-000001-AP',provider_name:'Entitat sintètica',source_payload:{fixture:'annex-boundary-unique-id'}});
  if(record.error)throw record.error;
  const doc=await db.from('source_documents').insert({id:item.doc,source_record_id:item.id,url,url_hash:createHash('sha256').update(url).digest('hex'),document_type:'official_resolution',status:'fetched',mime_type:'text/html',extracted_text:item.text,text_preview:item.text,text_length:item.text.length,quality_score:0.95,quality_flags:[],chunk_count:1,extraction_method:'fixture',source_fields:['synthetic-e2e']});
  if(doc.error)throw doc.error;
 }
});
test.afterAll(async()=>{
 if(!db)return;
 for(const item of cases){
  const doc=await db.from('source_documents').delete().eq('id',item.doc).eq('source_record_id',item.id);if(doc.error)throw doc.error;
  const record=await db.from('source_records').delete().eq('id',item.id).eq('source_record_id',`SYNTHETIC-E2E-${item.id}`);if(record.error)throw record.error;
 }
});
for(const item of cases)test(`annex boundary ${item.effect}`,async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const login=await page.request.post('/api/access/login',{form:{password:'local-workflow-fixture-only',next:'/batches'}});expect(login.ok()).toBeTruthy();
 await page.goto(`/records/${item.id}`);
 const assessment=page.getByTestId('concert-assessment');
 await expect(assessment).toHaveAttribute('data-effect',item.effect);
 await expect(assessment).toContainText(item.label);
 await expect(assessment).not.toContainText(item.forbidden);
 await expect(assessment).toContainText('Sempre pendent de revisió. No genera cap import automàtic.');
 const provisions=await db.from('service_provisions').select('id',{count:'exact',head:true}).eq('source_record_id',item.id);if(provisions.error)throw provisions.error;expect(provisions.count).toBe(0);
});
