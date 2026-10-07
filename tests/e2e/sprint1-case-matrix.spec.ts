import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {SPRINT1_CONCERT_CASES} from '../fixtures/sprint1-concert-cases';
import {readSource,sha256,SOURCE_BUCKET,SourceContentChangedError} from '../../lib/source-storage';

const marker='SPRINT01-E2E-';
let db:SupabaseClient;
const ids=new Map<number,string>();
const otherIds=new Map<string,string>();
let officialId='';
const archivedIds:string[]=[];

test.beforeAll(async()=>{
 const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
 if(status.API_URL!=='http://127.0.0.1:55421')throw Error('Only the isolated local test database may be used');
 db=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const stale=await db.from('source_records').select('id').like('source_record_id',`${marker}%`).eq('source_payload->>fixture','sprint01');
 if(stale.error)throw stale.error;
 if(stale.data?.length){const deleted=await db.from('source_records').delete().in('id',stale.data.map(row=>row.id));if(deleted.error)throw deleted.error;}
 officialId=randomUUID();
 const rows=[...SPRINT1_CONCERT_CASES.map(example=>{
  const id=randomUUID();ids.set(example.caseNo,id);
  return {id,source_dataset:'concerts',source_record_id:`${marker}${example.caseNo}-${id}`,mechanism:'Concert social / gestió delegada',title:example.title,provider_name:`Entitat fictícia ${example.caseNo}`,amount:null,source_payload:{fixture:'sprint01',pdf_case:example.caseNo,origin:'Synthetic fixture based on Sprint 1 PDF'}};
 }),...(['convenis','raisc_local','contractacions'] as const).map(dataset=>{
  const id=randomUUID();otherIds.set(dataset,id);
  return {id,source_dataset:dataset,source_record_id:`${marker}${dataset}-${id}`,mechanism:dataset==='convenis'?'Conveni':dataset==='raisc_local'?'Subvenció':'Contractació pública',title:`Cas transversal fictici ${dataset}`,provider_name:'Entitat fictícia transversal',amount:1250.25,source_payload:{fixture:'sprint01',excel_column:'valor original de prova'}};
 }),{id:officialId,source_dataset:'concerts',source_record_id:`${marker}OFFICIAL-${officialId}`,mechanism:'Concert social / gestió delegada',title:'Resolució de l’expedient: 25-000163-AP (Barcelona)',provider_name:null,amount:null,source_payload:{fixture:'sprint01',official_edition:'605700',record_url:'https://tauler.seu-e.cat/detall?idEns=1&idEdicte=605700'}}];
 const inserted=await db.from('source_records').insert(rows);
 if(inserted.error)throw inserted.error;
 const documents:Array<Record<string,unknown>>=SPRINT1_CONCERT_CASES.map(example=>{
  const url=`https://fixture.invalid/sprint01/${example.caseNo}`;
  const text=Array(4).fill(example.text).join(' ');
  return {source_record_id:ids.get(example.caseNo),url,url_hash:createHash('sha256').update(url).digest('hex'),document_type:'official_resolution',status:'fetched',mime_type:'text/html',extracted_text:text,text_preview:example.text,text_length:text.length,quality_score:0.95,quality_flags:[],chunk_count:1,extraction_method:'fixture',source_fields:['synthetic-e2e']};
 });
 const officialFile=resolve('tests/fixtures/official/25-000163-AP-barcelona-etauler-605700.pdf');
 const officialText=execFileSync('pdftotext',['-layout',officialFile,'-'],{encoding:'utf8',maxBuffer:2_000_000});
 const officialUrl='https://tauler.seu-e.cat/detall?idEns=1&idEdicte=605700';
 documents.push({source_record_id:officialId,url:officialUrl,url_hash:createHash('sha256').update(officialUrl).digest('hex'),document_type:'official_resolution',status:'fetched',mime_type:'application/pdf',extracted_text:officialText,text_preview:officialText.slice(0,600),text_length:officialText.length,quality_score:0.95,quality_flags:[],chunk_count:20,extraction_method:'pdftotext',source_fields:['public-eTauler']});
 for(const dataset of ['convenis','raisc_local','contractacions'] as const){
  const url=`https://fixture.invalid/sprint01/${dataset}`;
  documents.push({source_record_id:otherIds.get(dataset),url,url_hash:createHash('sha256').update(url).digest('hex'),document_type:'publication',status:'fetched',mime_type:'text/plain',extracted_text:`Font transversal de prova ${dataset}.`,text_preview:`Font transversal de prova ${dataset}.`,text_length:35,quality_score:0.95,quality_flags:[],chunk_count:1,extraction_method:'fixture',source_fields:['synthetic-e2e']});
 }
 const docs=await db.from('source_documents').insert(documents).select('id,source_record_id,url,mime_type');if(docs.error)throw docs.error;
 for(const doc of docs.data){
  const bytes=doc.source_record_id===officialId?readFileSync(officialFile):Buffer.from(doc.mime_type==='text/html'?`<html><body>${documents.find(row=>row.source_record_id===doc.source_record_id)!.extracted_text}</body></html>`:documents.find(row=>row.source_record_id===doc.source_record_id)!.extracted_text as string);
  const stored=await readSource(db,{...doc,content_hash:null},{bytes,mimeType:doc.mime_type});
  archivedIds.push(doc.id);
  expect(stored.path).toMatch(new RegExp(`^cases/${doc.source_record_id}/documents/${doc.id}/[a-f0-9]{64}\\.`));
  expect(stored.bytes).toEqual(bytes);
  expect(sha256(stored.bytes)).toBe(stored.sha256);
 }
});

test.afterAll(async()=>{
 if(!db)return;
 const all=[...ids.values(),...otherIds.values(),officialId].filter(Boolean);
 if(archivedIds.length){const source=await db.from('source_documents').select('storage_path').in('id',archivedIds);if(source.error)throw source.error;const paths=(source.data??[]).map(row=>row.storage_path).filter(Boolean);if(paths.length){const removed=await db.storage.from(SOURCE_BUCKET).remove(paths);if(removed.error)throw removed.error;}}
 if(all.length){const deleted=await db.from('source_records').delete().in('id',all);if(deleted.error)throw deleted.error;}
});

for(const example of SPRINT1_CONCERT_CASES){
 test(`PDF case ${example.caseNo} · ${example.example}: local UI shows a reviewable act`,async({page})=>{
  await page.request.post('/api/access/login',{form:{password:'local-workflow-fixture-only',next:'/batches'}});
  await page.goto(`/records/${ids.get(example.caseNo)}`);
  await expect(page.getByRole('heading',{name:'Resum del cas'})).toBeVisible();
  const assessment=page.getByTestId('concert-assessment');
  await expect(assessment).toContainText(`cas ${example.caseNo}`);
  await expect(assessment).toHaveAttribute('data-effect',example.effect);
  await expect(assessment).toContainText('Sempre pendent de revisió. No genera cap import automàtic.');
  const provisions=await db.from('service_provisions').select('id',{count:'exact',head:true}).eq('source_record_id',ids.get(example.caseNo)!);
  if(provisions.error)throw provisions.error;
  expect(provisions.count).toBe(0);
 });
}

test('official 8-page PDF from e-Tauler: 2025 award and full evidence remain visible',async({page})=>{
 await page.request.post('/api/access/login',{form:{password:'local-workflow-fixture-only',next:'/batches'}});
 await page.goto(`/records/${officialId}`);
 const assessment=page.getByTestId('concert-assessment');
 await expect(assessment).toContainText('cas 10');
 await expect(assessment).toHaveAttribute('data-effect','possible_award');
 await expect(assessment).toContainText('text del document');
 await expect(page.getByText('113.340,81', {exact:false})).toHaveCount(0);
 await page.getByRole('button',{name:'Mostra el text complet dels documents'}).click();
 await expect(page.getByText('113.340,81', {exact:false}).first()).toBeVisible();
 const provisions=await db.from('service_provisions').select('id',{count:'exact',head:true}).eq('source_record_id',officialId);
 if(provisions.error)throw provisions.error;
 expect(provisions.count).toBe(0);
 const source=await db.from('source_documents').select('id,storage_path,storage_sha256').eq('source_record_id',officialId).single();if(source.error)throw source.error;
 expect(source.data.storage_path).toMatch(new RegExp(`^cases/${officialId}/documents/${source.data.id}/[a-f0-9]{64}\\.pdf$`));
 const opened=await page.request.get(`/api/documents/${source.data.id}/open`);expect(opened.status()).toBe(200);expect(sha256(await opened.body())).toBe(source.data.storage_sha256);
});

for(const dataset of ['convenis','raisc_local','contractacions'] as const){
 test(`transversal ${dataset}: summary and original evidence remain accessible`,async({page})=>{
  await page.request.post('/api/access/login',{form:{password:'local-workflow-fixture-only',next:'/batches'}});
  await page.goto(`/records/${otherIds.get(dataset)}`);
  const source=await db.from('source_documents').select('id,storage_path,storage_sha256,mime_type,byte_size').eq('source_record_id',otherIds.get(dataset)!).single();if(source.error)throw source.error;
  expect(source.data.storage_path).toContain(`cases/${otherIds.get(dataset)}/documents/${source.data.id}/`);
  const opened=await page.request.get(`/api/documents/${source.data.id}/open`);expect(opened.status()).toBe(200);
  const bytes=Buffer.from(await opened.body());expect(sha256(bytes)).toBe(source.data.storage_sha256);
  expect(source.data.byte_size).toBe(bytes.length);
  expect(opened.headers()['content-type']).toContain(source.data.mime_type);
  expect(bytes.toString()).toContain(`Font transversal de prova ${dataset}`);
  await expect(page.getByRole('heading',{name:'Resum del cas'})).toBeVisible();
  await expect(page.getByText('Font: 1250.25')).toBeVisible();
  await expect(page.getByTestId('concert-assessment')).toHaveCount(0);
  await expect(page.getByText('valor original de prova')).toHaveCount(0);
  await page.getByRole('button',{name:'Mostra totes les dades originals'}).click();
  await expect(page.getByText('valor original de prova')).toBeVisible();
 });
}

test('a changed conveni source is never silently archived as its historical original',async()=>{
 const recordId=otherIds.get('convenis')!;
 const id=randomUUID(),url=`https://fixture.invalid/changed-${id}`;
 const inserted=await db.from('source_documents').insert({id,source_record_id:recordId,url,url_hash:sha256(Buffer.from(url)),document_type:'publication',status:'discovered',content_hash:sha256(Buffer.from('original document'))}).select('id,source_record_id,url,content_hash,storage_path,storage_sha256').single();
 if(inserted.error)throw inserted.error;
 await expect(readSource(db,inserted.data,{bytes:Buffer.from('changed document'),mimeType:'text/plain'})).rejects.toBeInstanceOf(SourceContentChangedError);
 const current=await db.from('source_documents').select('storage_path,storage_sha256').eq('id',id).single();
 if(current.error)throw current.error;
 expect(current.data.storage_path).toBeNull();expect(current.data.storage_sha256).toBeNull();
 const objects=await db.storage.from(SOURCE_BUCKET).list(`cases/${recordId}/documents/${id}`);
 if(objects.error)throw objects.error;
 expect(objects.data).toHaveLength(0);
});
