import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';

const id=()=>randomUUID(),previousId=id(),laterId=id(),previousDoc=id(),laterDoc=id(),linkId=id();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const previousText=`## Pàgina 1\n${'Resolució de provisió de serveis documentats. '.repeat(10)}\n## Pàgina 4\nAnnex\nS11111 Servei un BE-2023-N123 2600000001 1 Barcelona\nS22222 Servei dos BE-2023-N456 2600000002 1 Girona`;
const laterText=`## Pàgina 1\nFets\n1. En data 29 de febrer de 2024, el conseller emet una resolució per a la provisió dels serveis.\n2. A l'annex s'indica que els números del servei amb codi RESES S11111 són, respectivament, BE-2023-N123 i 2600000001. Es tracta d'un error, ja que el número d'expedient GECAT correcte és BE-2024-N789 i el número de disposició correcte és 2600000003.\n3. A l'annex s'indica que els números del servei amb codi RESES S22222 són, respectivament, BE-2023-N456 i 2600000002. Es tracta també d'un error, ja que el número d'expedient GECAT correcte és BE-2024-N987 i el número de disposició correcte és 2600000004.\nFonaments de dret\nNormes aplicables.\n## Pàgina 2\nRESOLC: 1. Esmenar la resolució anterior.\n## Pàgina 3\nExpedient GECAT Disposició Posició\nS11111 Servei un BE-2024-N789 2600000003 1\nS22222 Servei dos BE-2024-N987 2600000004 1\n2. Notificar la resolució.`;
let db:SupabaseClient;
test.beforeAll(async()=>{
 const dbProject=execFileSync('docker',['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_db_cartera-workflow-test'],{encoding:'utf8',timeout:10_000}).trim();
 const apiProject=execFileSync('docker',['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}','supabase_kong_cartera-workflow-test'],{encoding:'utf8',timeout:10_000}).trim();
 if(dbProject!=='cartera-workflow-test'||apiProject!=='cartera-workflow-test')throw Error('Only the isolated local test project may be used');
 const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
 if(status.API_URL!=='http://127.0.0.1:55421')throw Error('Only the isolated local test database may be used');
 db=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 for(const item of [{id:previousId,doc:previousDoc,text:previousText,date:'2024-03-01',title:'Resolució anterior sintètica'},{id:laterId,doc:laterDoc,text:laterText,date:'2024-05-29',title:'Esmena sintètica'}]){
  const url=`https://fixture.invalid/${item.doc}`,digest='a'.repeat(64);
  const record=await db.from('source_records').insert({id:item.id,source_dataset:'concerts',source_record_id:`SYNTHETIC-E2E-${item.id}`,mechanism:'Concert social / gestió delegada',title:item.title,source_payload:{fixture:'administrative-predecessor-unique-id',data_publicacio:item.date}});if(record.error)throw record.error;
  const doc=await db.from('source_documents').insert({id:item.doc,source_record_id:item.id,url,url_hash:hash(url),document_type:'official_resolution',status:'fetched',mime_type:'application/pdf',extracted_text:item.text,extracted_text_hash:hash(item.text),text_preview:item.text,text_length:item.text.length,quality_score:0.95,quality_flags:[],chunk_count:1,extraction_method:'pdf-text-markdown-v2',extraction_partial:false,extraction_coverage:{complete:true},storage_sha256:digest,storage_path:`cases/${item.id}/documents/${item.doc}/${digest}.pdf`,active_extraction_id:id(),source_fields:['synthetic-e2e']});if(doc.error)throw doc.error;
 }
 const link=await db.from('concert_record_links').insert({id:linkId,later_record_id:laterId,earlier_record_id:previousId,link_kind:'amendment',matching_method:'explicit_resolution',status:'candidate',evidence:'Proposta sintètica pendent de revisió'});if(link.error)throw link.error;
});
test.afterAll(async()=>{
 if(!db)return;
 const link=await db.from('concert_record_links').delete().eq('id',linkId).eq('later_record_id',laterId).eq('earlier_record_id',previousId);if(link.error)throw link.error;
 for(const item of [{id:previousId,doc:previousDoc},{id:laterId,doc:laterDoc}]){
  const doc=await db.from('source_documents').delete().eq('id',item.doc).eq('source_record_id',item.id);if(doc.error)throw doc.error;
  const record=await db.from('source_records').delete().eq('id',item.id).eq('source_record_id',`SYNTHETIC-E2E-${item.id}`);if(record.error)throw record.error;
 }
});
test('candidate amendment remains reviewable without claiming documentary comparison',async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const login=await page.request.post('/api/access/login',{form:{password:'local-workflow-fixture-only',next:'/batches'}});expect(login.ok()).toBeTruthy();
 await page.goto(`/records/${laterId}`);
 const history=page.getByTestId('concert-history');
 await expect(history).toContainText('Possible vincle · pendent de contrast');
 await expect(history).toContainText('El contrast documental de l’esmena està pendent');
 await expect(history).toContainText('Resolució anterior sintètica');
 await expect(page.getByRole('region',{name:'Contrast documental de l’esmena'})).toHaveCount(0);
 const changed=await db.from('source_documents').update({extracted_text:previousText+' canvi'}).eq('id',previousDoc).eq('source_record_id',previousId);if(changed.error)throw changed.error;
 await page.reload();await expect(history).toContainText('El contrast documental de l’esmena està pendent');
 await expect(page.getByRole('region',{name:'Contrast documental de l’esmena'})).toHaveCount(0);
 const link=await db.from('concert_record_links').select('status').eq('id',linkId).single();if(link.error)throw link.error;expect(link.data.status).toBe('candidate');
 const provisions=await db.from('service_provisions').select('id',{count:'exact',head:true}).eq('source_record_id',laterId);if(provisions.error)throw provisions.error;expect(provisions.count).toBe(0);
});
