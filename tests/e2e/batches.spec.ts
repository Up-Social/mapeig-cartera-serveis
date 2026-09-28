import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';

let db:SupabaseClient;
let pausedRun='';
let pausedRecord='';
let operationRun='';
let operationRecord='';

async function cleanupFixtures(recordIds:string[]){
 if(!recordIds.length)return;
 const jobs=await db.from('pipeline_jobs').select('id,run_id').in('source_record_id',recordIds);
 if(jobs.error)throw jobs.error;
 const jobIds=(jobs.data??[]).map(row=>row.id);
 const runIds=[...new Set((jobs.data??[]).map(row=>row.run_id))];
 if(jobIds.length){
  const snapshots=await db.from('job_snapshots').select('id').in('pipeline_job_id',jobIds);
  if(snapshots.error)throw snapshots.error;
  const snapshotIds=(snapshots.data??[]).map(row=>row.id);
  if(snapshotIds.length){
   const links=await db.from('job_document_versions').delete().in('snapshot_id',snapshotIds);if(links.error)throw links.error;
  }
  const snapshotDelete=await db.from('job_snapshots').delete().in('pipeline_job_id',jobIds);if(snapshotDelete.error)throw snapshotDelete.error;
  const attemptDelete=await db.from('job_attempts').delete().in('pipeline_job_id',jobIds);if(attemptDelete.error)throw attemptDelete.error;
 }
 if(runIds.length){const runs=await db.from('pipeline_runs').delete().in('id',runIds);if(runs.error)throw runs.error;}
 const records=await db.from('source_records').delete().in('id',recordIds);if(records.error)throw records.error;
}

test.beforeAll(async()=>{
 const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
 if(new URL(status.API_URL).hostname!=='127.0.0.1')throw new Error('E2E refused a non-loopback database');
 db=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 const check=(error:unknown)=>{if(error)throw error;};
 const staleRecords=await db.from('source_records').select('id').like('source_record_id','E2E-%');check(staleRecords.error);
 const staleIds=(staleRecords.data??[]).map(row=>row.id);
 await cleanupFixtures(staleIds);
 pausedRun=randomUUID();pausedRecord=randomUUID();operationRun=randomUUID();operationRecord=randomUUID();
 check((await db.from('cloud_resources').update({blocked_kind:null}).eq('name','sandbox')).error);
 check((await db.from('source_records').insert([
  {id:pausedRecord,source_dataset:'contractacions',source_record_id:`E2E-PAUSED-${pausedRecord}`,mechanism:'Contractació pública',title:'Lot pausat fictici',source_payload:{fixture:true},processing_status:'preparant'},
  {id:operationRecord,source_dataset:'convenis',source_record_id:`E2E-OPERATION-${operationRecord}`,mechanism:'Conveni',title:'Operació individual pausada fictícia',source_payload:{fixture:true},processing_status:'preparant'},
 ])).error);
 check((await db.from('pipeline_runs').insert([
  {id:pausedRun,status:'paused',stage:'preparation',pause_kind:'vercel_quota',pause_reason:'Execució pausada: vercel_quota',parameters:{purpose:'automated_cloud'}},
  {id:operationRun,status:'paused',stage:'preparation',pause_kind:'vercel_quota',pause_reason:'Execució pausada: vercel_quota',parameters:{purpose:'record_operation',operation:'process'}},
 ])).error);
 const jobs=await db.from('pipeline_jobs').insert([
  {run_id:pausedRun,source_record_id:pausedRecord,status:'selected',preparation_status:'pending',enrichment_status:'pending'},
  {run_id:operationRun,source_record_id:operationRecord,status:'selected',preparation_status:'pending',enrichment_status:'pending'},
 ]).select('id,run_id');check(jobs.error);
 check((await db.from('worker_tasks').insert((jobs.data??[]).map(job=>({task_type:'process_run',run_id:job.run_id,pipeline_job_id:job.id,executor:'vercel_workflow'})))).error);
 check((await db.from('worker_tasks').update({status:'failed',execution_state:'paused',failure_kind:'vercel_quota'}).in('run_id',[pausedRun,operationRun])).error);
 check((await db.from('cloud_resources').update({blocked_kind:'vercel_quota'}).eq('name','sandbox')).error);
});

test.afterAll(async()=>{
 if(!db)return;
 await db.from('cloud_resources').update({blocked_kind:null}).eq('name','sandbox');
 await cleanupFixtures([pausedRecord,operationRecord]);
});

async function login(page:Page){
 await page.goto('/batches');
 await page.getByRole('textbox',{name:'Contrasenya'}).fill('local-workflow-fixture-only');
 await Promise.all([page.waitForURL('**/batches'),page.getByRole('button',{name:'Entrar'}).click()]);
 await page.locator('[data-app-ready="true"]').waitFor();
}

test('blocked batch is understandable and actionable',async({page})=>{
 await login(page);
 await expect(page.getByRole('alert').filter({hasText:'Processament temporalment aturat'})).toContainText('Quota de Vercel esgotada');
 await expect(page.getByRole('button',{name:'Processament no disponible'})).toBeDisabled();
 await page.getByRole('button',{name:'Lots'}).click();
 await page.getByRole('button',{name:'Pausats'}).click();
 const heading=page.getByRole('button',{name:/Lot .*Pausat per quota/}).first();
 await heading.click();
 await expect(page.getByText(/0 completats · 0 errors · 1 bloquejats/).first()).toBeVisible();
 await page.getByText('Veure el detall de les tres fases').click();
 await expect(page.getByText(/0 errors propis · 1 bloquejats · 0 pendents/).first()).toBeVisible();
 await expect(page.getByText('Lot pausat fictici')).toBeVisible();
 await page.getByRole('button',{name:/Lot pausat fictici/}).click();
 await expect(page.getByRole('link',{name:'Obrir registre'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Obrir resultat i evidència'})).toBeVisible();
});

test('results explain blocked work and open the record',async({page})=>{
 await login(page);
 await page.goto(`/batches/${pausedRun}/results`);
 await expect(page.getByRole('status')).toContainText('Aquest lot està aturat');
 await expect(page.getByText(/Estat: Bloquejat/)).toBeVisible();
 await page.getByRole('link',{name:'Obrir registre'}).click();
 await expect(page).toHaveURL(new RegExp(`record=${pausedRecord}`));
 await expect(page.getByText('Processament temporalment aturat')).toBeVisible();
 await page.getByRole('button',{name:/Lot pausat fictici/}).click();
 await expect(page.getByRole('button',{name:'Processament no disponible'})).toBeDisabled();
});

test('individual operations are separated from normal batches',async({page})=>{
 await login(page);
 await page.getByRole('button',{name:'Operacions individuals'}).click();
 await page.getByRole('button',{name:'Pausats'}).click();
 await page.getByRole('button',{name:/Operació .*Pausat per quota/}).first().click();
 await expect(page.getByText('Operació individual pausada fictícia')).toBeVisible();
});

test('batch controls remain usable on a mobile viewport',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='mobile','mobile-only assertion');
 await login(page);
 await expect(page.getByRole('alert').filter({hasText:'Processament temporalment aturat'})).toBeVisible();
 await page.getByRole('button',{name:'Lots'}).click();
 await page.getByRole('button',{name:'Pausats'}).click();
 await expect(page.getByRole('button',{name:/Lot .*Pausat per quota/}).first()).toBeVisible();
});
