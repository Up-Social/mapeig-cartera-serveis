import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';

let db:SupabaseClient;
let pausedRun='';
let pausedRecord='';
let operationRun='';
let operationRecord='';
let diagnosticRun='';
let reviewRecord='';
let technicalRecord='';

async function cleanupFixtures(recordIds:string[]){
 if(!recordIds.length)return;
 const jobs=await db.from('pipeline_jobs').select('id,run_id').in('source_record_id',recordIds);
 if(jobs.error)throw jobs.error;
  const jobIds=(jobs.data??[]).map(row=>row.id);
 const runIds=[...new Set((jobs.data??[]).map(row=>row.run_id))];
  if(jobIds.length){
  const analyses=await db.from('analysis_results').delete().in('pipeline_job_id',jobIds);if(analyses.error)throw analyses.error;
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
 pausedRun=randomUUID();pausedRecord=randomUUID();operationRun=randomUUID();operationRecord=randomUUID();diagnosticRun=randomUUID();reviewRecord=randomUUID();technicalRecord=randomUUID();
 check((await db.from('cloud_resources').update({blocked_kind:null}).eq('name','sandbox')).error);
 check((await db.from('source_records').insert([
  {id:pausedRecord,source_dataset:'contractacions',source_record_id:`E2E-PAUSED-${pausedRecord}`,mechanism:'Contractació pública',title:'Lot pausat fictici',source_payload:{fixture:true},processing_status:'preparant'},
  {id:operationRecord,source_dataset:'convenis',source_record_id:`E2E-OPERATION-${operationRecord}`,mechanism:'Conveni',title:'Operació individual pausada fictícia',source_payload:{fixture:true},processing_status:'preparant'},
  {id:reviewRecord,source_dataset:'convenis',source_record_id:`E2E-REVIEW-${reviewRecord}`,mechanism:'Conveni',title:'Conveni pendent de revisió fictici',source_payload:{fixture:true},processing_status:'revisio'},
  {id:technicalRecord,source_dataset:'raisc_local',source_record_id:`E2E-ERROR-${technicalRecord}`,mechanism:'Subvenció',title:'Subvenció amb document tècnic fictici',source_payload:{fixture:true},processing_status:'error'},
 ])).error);
 check((await db.from('pipeline_runs').insert([
  {id:pausedRun,status:'paused',stage:'preparation',pause_kind:'vercel_quota',pause_reason:'Execució pausada: vercel_quota',parameters:{purpose:'automated_cloud'}},
  {id:operationRun,status:'paused',stage:'preparation',pause_kind:'vercel_quota',pause_reason:'Execució pausada: vercel_quota',parameters:{purpose:'record_operation',operation:'process'}},
  {id:diagnosticRun,status:'completed',stage:'review',parameters:{purpose:'automated_cloud'}},
 ])).error);
 const jobs=await db.from('pipeline_jobs').insert([
  {run_id:pausedRun,source_record_id:pausedRecord,status:'selected',preparation_status:'pending',enrichment_status:'pending'},
  {run_id:operationRun,source_record_id:operationRecord,status:'selected',preparation_status:'pending',enrichment_status:'pending'},
  {run_id:diagnosticRun,source_record_id:reviewRecord,status:'needs_review',preparation_status:'ready',enrichment_status:'completed'},
  {run_id:diagnosticRun,source_record_id:technicalRecord,status:'error',preparation_status:'error',preparation_message:'Document no processable.',enrichment_status:'pending',error_message:'Document no processable.'},
 ]).select('id,run_id,source_record_id');check(jobs.error);
 const reviewJob=(jobs.data??[]).find(job=>job.run_id===diagnosticRun&&job.source_record_id===reviewRecord);
 const catalog=await db.from('catalog_versions').select('id').eq('active',true).eq('validated',true).limit(1).single();
 if(catalog.error||!catalog.data)throw catalog.error??new Error('Missing active catalog fixture');
 if(!reviewJob)throw new Error('Missing review fixture job');
 check((await db.from('analysis_results').insert({pipeline_job_id:reviewJob.id,source_record_id:reviewRecord,catalog_version_id:catalog.data.id,rules_version:'e2e-rules',classification:'insufficient_evidence',reasons:[],explanation:'No consta la població destinatària del servei en la documentació disponible.',service_description:'Servei d’acompanyament social',target_population:'',evidence:[{content:'Fragment oficial fictici'}]})).error);
 check((await db.rpc('refresh_pipeline_run',{p_run_id:diagnosticRun})).error);
 check((await db.from('worker_tasks').insert((jobs.data??[]).filter(job=>[pausedRun,operationRun].includes(job.run_id)).map(job=>({task_type:'process_run',run_id:job.run_id,pipeline_job_id:job.id,executor:'vercel_workflow'})))).error);
 check((await db.from('worker_tasks').update({status:'failed',execution_state:'paused',failure_kind:'vercel_quota'}).in('run_id',[pausedRun,operationRun])).error);
 check((await db.from('cloud_resources').update({blocked_kind:'vercel_quota'}).eq('name','sandbox')).error);
});

test.afterAll(async()=>{
 if(!db)return;
 await db.from('cloud_resources').update({blocked_kind:null}).eq('name','sandbox');
 await cleanupFixtures([pausedRecord,operationRecord,reviewRecord,technicalRecord]);
});

async function login(page:Page){
 await page.goto('/batches');
 await page.getByRole('textbox',{name:'Contrasenya'}).fill('local-workflow-fixture-only');
 await Promise.all([page.waitForURL('**/batches'),page.getByRole('button',{name:'Entrar'}).click()]);
 await page.locator('[data-app-ready="true"]').waitFor();
}

async function expectBatchActionHoverContrast(page:Page){
 for(const action of await page.locator('main .batch-action').all()){
  if(!await action.isVisible()||!await action.isEnabled())continue;
  const label=await action.innerText();
  await action.hover();
  const contrast=await action.evaluate((element)=>{
   const style=getComputedStyle(element);
   const canvas=new OffscreenCanvas(1,1);
   const context=canvas.getContext('2d');
   if(!context)return {ratio:0,color:style.color,background:style.backgroundColor};
   const parse=(value:string)=>{
    context.clearRect(0,0,1,1);
    context.fillStyle=value;
    context.fillRect(0,0,1,1);
    return Array.from(context.getImageData(0,0,1,1).data.slice(0,3));
   };
   const luminance=(rgb:number[])=>{
    const values=rgb.map(value=>{const channel=value/255;return channel<=0.03928?channel/12.92:((channel+0.055)/1.055)**2.4;});
    return values[0]*0.2126+values[1]*0.7152+values[2]*0.0722;
   };
   const foreground=luminance(parse(style.color));
   const background=luminance(parse(style.backgroundColor));
   return {ratio:(Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05),color:style.color,background:style.backgroundColor};
  });
  expect(contrast.ratio,`${label}: ${contrast.color} sobre ${contrast.background}`).toBeGreaterThanOrEqual(4.5);
 }
}

test('blocked batch is understandable and actionable',async({page})=>{
 await login(page);
 await expect(page.getByRole('alert').filter({hasText:'Processament temporalment aturat'})).toContainText('Quota de Vercel esgotada');
 await expect(page.getByRole('button',{name:'Processament no disponible'})).toBeDisabled();
 await page.getByRole('button',{name:'Lots'}).click();
 await page.getByRole('button',{name:'Requereixen atenció'}).click();
 const quickResume=page.getByRole('button',{name:/Reprendre lot /}).first();
 await expect(quickResume).toBeVisible();
 await expect(quickResume).toBeDisabled();
 const heading=page.getByRole('button',{name:/Lot .*Pausat per quota/}).first();
 await heading.click();
 await expect(page.getByRole('heading',{name:'Processament aturat'})).toBeVisible();
 await expect(page.getByText('100%')).toHaveCount(0);
 await page.getByText('Veure detall tècnic de les fases').click();
 await expect(page.getByText(/0 errors propis · 1 bloquejats · 0 pendents/).first()).toBeVisible();
 await page.getByRole('link',{name:/Obrir detall del lot/}).click();
 await expect(page.getByRole('heading',{name:'Lot pausat fictici'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Obrir registre'})).toBeVisible();
});

test('Vercel can be checked without resuming paused work',async({page})=>{
 await login(page);
 try{
  await page.getByRole('button',{name:'Comprovar si Vercel torna a estar disponible'}).click();
  await expect(page.getByRole('alert').filter({hasText:'Processament temporalment aturat'})).toBeHidden();
  await expect(page.getByText('Vercel torna a estar disponible. Cap lot s’ha reprès automàticament.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Crear i processar lot'})).toBeEnabled();
  await page.getByRole('button',{name:'Lots'}).click();
  await page.getByRole('button',{name:'Requereixen atenció'}).click();
  await expect(page.getByRole('button',{name:/Reprendre lot /}).first()).toBeEnabled();
  await page.getByRole('button',{name:/Lot .*Pausat per quota/}).first().click();
  await expect(page.getByRole('button',{name:'Reprendre només aquest lot'})).toBeVisible();
  const task=await db.from('worker_tasks').select('execution_state,failure_kind').eq('run_id',pausedRun).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).single();
  if(task.error)throw task.error;
  expect(task.data).toMatchObject({execution_state:'paused',failure_kind:'vercel_quota'});
 }finally{
  const restored=await db.from('cloud_resources').update({blocked_kind:'vercel_quota',owner:null,lease_until:null}).eq('name','sandbox');
  if(restored.error)throw restored.error;
 }
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

test('results explain human review and technical errors with accessible actions',async({page})=>{
 await login(page);
 await page.goto(`/batches/${diagnosticRun}/results`);
 await expect(page.getByRole('heading',{name:/Lot /})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Revisions humanes pendents'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Errors tècnics'})).toBeVisible();
 const reviewCard=page.getByRole('article').filter({hasText:'Conveni pendent de revisió fictici'});
 await expect(reviewCard).toContainText('Cal revisar la falta d’evidència');
 await expect(reviewCard).toContainText('No consta la població destinatària');
 await expect(reviewCard.getByRole('link',{name:'Revisar ara'})).toBeVisible();
 const technicalCard=page.getByRole('article').filter({hasText:'Subvenció amb document tècnic fictici'});
 await expect(technicalCard).toContainText('Preparació de fonts');
 await expect(technicalCard).toContainText('No s’ha pogut llegir cap document útil');
 await expect(technicalCard.getByRole('link',{name:'Veure incidència'})).toBeVisible();
 await technicalCard.getByText('Veure detall tècnic').click();
 await expect(technicalCard).toContainText('Document no processable.');

 await expectBatchActionHoverContrast(page);
});

test('batch summary, detail and review form one coherent route',async({page})=>{
 await login(page);
 await page.getByRole('button',{name:'Requereixen atenció',exact:true}).click();
 const row=page.getByRole('button',{name:/Lot .*2 registres · 1 per revisar · 1 error tècnic/}).first();
 await expect(row).toBeVisible();
 await row.click();
 await expect(page.getByText('2 registres · 1 per revisar · 1 error tècnic')).toHaveCount(2);
 await expect(page.getByText('100%')).toHaveCount(0);
 await Promise.all([
  page.waitForURL(`**/batches/${diagnosticRun}/results`),
  page.getByRole('link',{name:'Obrir detall del lot (2)'}).click(),
 ]);
 await expect(page.getByRole('heading',{level:1})).toContainText('Lot ');
 await expect(page.getByRole('navigation',{name:'Filtrar registres del lot'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Tots (2)'})).toHaveAttribute('aria-current','page');
 await expect(page.getByText('Filtres avançats')).toBeVisible();
 await page.getByRole('link',{name:'Errors (1)'}).click();
 await expect(page.getByText('Subvenció amb document tècnic fictici')).toBeVisible();
 await expect(page.getByText('Conveni pendent de revisió fictici')).toHaveCount(0);
 await page.getByRole('link',{name:'Per revisar (1)'}).click();
 await page.getByRole('link',{name:'Revisar ara'}).click();
 await expect(page.getByRole('link',{name:'Tornar al detall del lot'})).toBeVisible();
});

test('all visible batch actions keep their text contrast on hover',async({page})=>{
 await login(page);
 await expectBatchActionHoverContrast(page);
 await page.getByRole('button',{name:'Requereixen atenció',exact:true}).click();
 await page.getByRole('button',{name:/Lot .*Lot preparat per revisar/}).first().click();
 await expect(page.getByRole('link',{name:/Revisar .* pendent/})).toBeVisible();
 await expectBatchActionHoverContrast(page);
});

test('individual operations are separated from normal batches',async({page})=>{
 await login(page);
 await page.getByRole('button',{name:'Operacions individuals'}).click();
 await page.getByRole('button',{name:'Requereixen atenció'}).click();
 await page.getByRole('button',{name:/Operació .*Pausat per quota/}).first().click();
 await expect(page.getByText('Operació individual pausada fictícia')).toBeVisible();
});

test('batch controls remain usable on a mobile viewport',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='mobile','mobile-only assertion');
 await login(page);
 await expect(page.getByRole('alert').filter({hasText:'Processament temporalment aturat'})).toBeVisible();
 await page.getByRole('button',{name:'Lots'}).click();
 await page.getByRole('button',{name:'Requereixen atenció'}).click();
 await expect(page.getByRole('button',{name:/Lot .*Pausat per quota/}).first()).toBeVisible();
});

test('automatic OCR can be disabled and enabled from administration',async({page})=>{
 await login(page);
 await page.goto('/admin');
 await expect(page.getByRole('heading',{name:'Configuració del processament'})).toBeVisible();
 await expect(page.getByTestId('ocr-status')).toHaveText('Activat');
 await page.getByRole('button',{name:'Desactivar OCR automàtic'}).click();
 await expect(page.getByRole('status')).toContainText('ha quedat desactivat');
 await expect(page.getByTestId('ocr-status')).toHaveText('Desactivat');
 const disabled=await db.from('app_settings').select('enabled').eq('key','automatic_ocr').single();
 if(disabled.error)throw disabled.error;
 expect(disabled.data.enabled).toBe(false);
 await page.getByRole('button',{name:'Activar OCR automàtic'}).click();
 await expect(page.getByRole('status')).toContainText('ha quedat activat');
 await expect(page.getByTestId('ocr-status')).toHaveText('Activat');
 const enabled=await db.from('app_settings').select('enabled').eq('key','automatic_ocr').single();
 if(enabled.error)throw enabled.error;
 expect(enabled.data.enabled).toBe(true);
});

test('a paused batch can be resumed directly from the list after Vercel recovers',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop','desktop mutation assertion');
 await login(page);
 try{
  await page.getByRole('button',{name:'Comprovar si Vercel torna a estar disponible'}).click();
  await expect(page.getByRole('alert').filter({hasText:'Processament temporalment aturat'})).toBeHidden();
  await page.getByRole('button',{name:'Requereixen atenció'}).click();
  const quickResume=page.getByRole('button',{name:/Reprendre lot /}).first();
  await expect(quickResume).toBeEnabled();
  await quickResume.click();
  await expect(page.getByRole('status')).toContainText('s’ha reprès correctament');
  const task=await db.from('worker_tasks').select('execution_state,failure_kind').eq('run_id',pausedRun).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).single();
  if(task.error)throw task.error;
  expect(task.data.execution_state).toBe('pending');
  expect(task.data.failure_kind).toBeNull();
 }finally{
  const task=await db.from('worker_tasks').update({status:'failed',execution_state:'paused',failure_kind:'vercel_quota',dispatch_at:null,workflow_id:null,lease_until:null,lease_owner:null}).eq('run_id',pausedRun);
  if(task.error)throw task.error;
  const restored=await db.from('cloud_resources').update({blocked_kind:'vercel_quota',owner:null,lease_until:null}).eq('name','sandbox');
  if(restored.error)throw restored.error;
 }
});
