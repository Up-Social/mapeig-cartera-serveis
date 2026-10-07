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
 const password='local-workflow-fixture-only';
 await page.goto('/batches');
 await page.locator('[data-app-ready="true"]').waitFor();
 await page.getByRole('textbox',{name:'Contrasenya'}).fill(password);
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

test('blocked batches have readable details without disclosures',async({page})=>{
 await login(page);
 await expect(page.getByRole('button',{name:'Processament no disponible'})).toBeDisabled();
 await page.goto(`/batches/${pausedRun}`);
 await expect(page.getByRole('heading',{name:'Processament aturat'})).toBeVisible();
 await expect(page.locator('details')).toHaveCount(0);
 await expect(page.getByText('Veure detall tècnic de les fases')).toBeVisible();
 await expectBatchActionHoverContrast(page);
});
test('technical incidence finishes the record spinner and retains explanation',async({page})=>{
 await login(page);
 const matching=await db.from('pipeline_jobs').update({status:'matching',preparation_status:'ready',enrichment_status:'completed'}).eq('run_id',operationRun);if(matching.error)throw matching.error;
 await db.from('worker_tasks').update({current_step:'matching',progress_completed:0,progress_total:1,failure_kind:'internal'}).eq('run_id',operationRun);
 await page.goto(`/records/${operationRecord}`);
 await expect(page.getByRole('heading',{level:1})).toContainText('Operació individual pausada');
 await expect(page.getByText('Incidència tècnica',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Processant...',exact:true})).toHaveCount(0);
 await expect(page.getByText('Interromput durant la correspondència')).toBeVisible();
 await expect(page.getByText(/Encara no hi ha cap resultat de correspondència guardat/)).toBeVisible();
 await expect(page.getByText(/La revisió encara no està disponible/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Desar decisió',exact:true})).toHaveCount(0);
 await expect(page.locator('details')).toHaveCount(0);
});
test('batch results link to a visible review and keep the return context',async({page})=>{
 await login(page);await page.goto(`/batches/${diagnosticRun}/results`);
 await expect(page.getByRole('heading',{name:'Errors tècnics'})).toBeVisible();
 const technical=page.getByRole('article').filter({hasText:'Subvenció amb document tècnic fictici'});
 await expect(technical).toContainText('Document no processable.');
 await expect(page.locator('details')).toHaveCount(0);
 await page.getByRole('link',{name:'Revisar ara'}).click();
 await expect(page).toHaveURL(new RegExp(`/records/${reviewRecord}`));
 await expect(page.getByRole('heading',{name:'Resultat de l’anàlisi'})).toBeVisible();
 await expect(page.getByText('Evidència de l’expedient',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Tornar al llistat'})).toHaveAttribute('href',new RegExp(`/batches/${diagnosticRun}/results`));
 await expect(page.locator('details')).toHaveCount(0);
});
test('catalog groups explain hierarchy and SAD retains complete normative functions',async({page})=>{
 await login(page);await page.goto('/catalog/1.1.2');
 await expect(page.getByRole('heading',{name:'Prestacions d’aquest agrupador'})).toBeVisible();
 await page.getByRole('link',{name:/1.1.2.1 · Servei d'ajuda/}).click();
 await expect(page.getByRole('heading',{name:'Fitxa normativa completa'})).toBeVisible();
 await expect(page.getByText('Ajuda a la llar.',{exact:false}).first()).toBeVisible();
 await expect(page.getByRole('heading',{name:'Condicions d’accés'})).toBeVisible();
 await expect(page.locator('details')).toHaveCount(0);
 await page.screenshot({path:`docs/local/implementation-20260930/catalog-${test.info().project.name}.png`,fullPage:true});
});
test('batch creation has no year filter and costs remain explicit',async({page})=>{
 await login(page);await expect(page.getByLabel('Any de la font')).toHaveCount(0);
 await expect(page.getByText(/auditories tenen cost de tokens/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Processament no disponible'})).toBeDisabled();
});
test('checking cloud availability does not resume paused tasks',async({page})=>{
 await login(page);
 try{
  await page.getByRole('button',{name:'Comprovar si Vercel torna a estar disponible'}).click();
  await expect(page.getByText('Vercel torna a estar disponible. Cap lot s’ha reprès automàticament.')).toBeVisible({timeout:30_000});
  await expect(page.getByRole('button',{name:'Crear i processar lot'})).toBeEnabled();
  const task=await db.from('worker_tasks').select('execution_state').eq('run_id',pausedRun).single();
  expect(task.data?.execution_state).toBe('paused');
 }finally{await db.from('cloud_resources').update({blocked_kind:'vercel_quota'}).eq('name','sandbox');}
});
test('OCR setting is reversible in the isolated database',async({page})=>{
 const previous=await db.from('app_settings').select('enabled').eq('key','automatic_ocr').single();if(previous.error)throw previous.error;
 const reset=await db.from('app_settings').update({enabled:true}).eq('key','automatic_ocr');if(reset.error)throw reset.error;
 try{
  await login(page);await page.goto('/admin');
  await expect(page.getByTestId('ocr-status')).toHaveText('Activat');
  await page.getByRole('button',{name:'Desactivar OCR automàtic'}).click();
  await expect(page.getByTestId('ocr-status')).toHaveText('Desactivat');
  await page.getByRole('button',{name:'Activar OCR automàtic'}).click();
  await expect(page.getByTestId('ocr-status')).toHaveText('Activat');
 }finally{const restored=await db.from('app_settings').update({enabled:previous.data.enabled}).eq('key','automatic_ocr');if(restored.error)throw restored.error;}
});
test('process help describes partial OCR and individual concert approvals',async({page})=>{
 await login(page);await page.goto('/process');
 await expect(page.getByRole('heading',{name:'Concerts amb diverses transaccions'})).toBeVisible();
 await expect(page.getByText(/25 pàgines OCR/)).toBeVisible();
 await expect(page.locator('details')).toHaveCount(0);
});
