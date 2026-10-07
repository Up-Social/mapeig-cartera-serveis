import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import {archiveSource,sha256,SOURCE_BUCKET} from '../../lib/source-storage';
let db:SupabaseClient;let recordId='';let docId='';let code='';let quotes:string[]=[];let storedBytes:Buffer;
function sql(input:string){return execFileSync('docker',['exec','-i','supabase_db_cartera-workflow-test','psql','-U','postgres','-X','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8'});}
function cleanupUnitFixtures(){
 // Only disposable fixtures in the explicitly named isolated test database.
 sql(`begin;
 create temporary table unit_fixture_ids on commit drop as select id from source_records where source_record_id like 'UNITUI-%' and title='Unit fixture';
 create temporary table unit_fixture_jobs on commit drop as select id,run_id from pipeline_jobs where source_record_id in(select id from unit_fixture_ids);
 delete from excel_export_items where provision_id in(select id from service_provisions where source_record_id in(select id from unit_fixture_ids));
 delete from service_provisions where source_record_id in(select id from unit_fixture_ids);
 delete from review_decisions where source_record_id in(select id from unit_fixture_ids);
 delete from record_units where source_record_id in(select id from unit_fixture_ids);
 delete from analysis_results where source_record_id in(select id from unit_fixture_ids);
 delete from job_document_versions where snapshot_id in(select id from job_snapshots where pipeline_job_id in(select id from unit_fixture_jobs));
 delete from document_versions where source_document_id in(select id from source_documents where source_record_id in(select id from unit_fixture_ids));
 delete from job_snapshots where pipeline_job_id in(select id from unit_fixture_jobs);
 delete from job_attempts where pipeline_job_id in(select id from unit_fixture_jobs);
 delete from pipeline_runs where id in(select run_id from unit_fixture_jobs);
 delete from source_records where id in(select id from unit_fixture_ids);
 commit;`);
}
test.beforeAll(async()=>{
 const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
 if(status.API_URL!=='http://127.0.0.1:55421')throw Error('Only isolated DB allowed');
 db=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 cleanupUnitFixtures();
 // Same regression fixture as SQL, stopped before units are created.
 const fixture=readFileSync('tests/sql/13-record-units.sql','utf8').split(' payload:=jsonb_build_object')[0].replace("'UNITS-'","'UNITUI-'");
 sql(fixture+"\nend $$;");
 const record=await db.from('source_records').select('id').like('source_record_id','UNITUI-%').order('created_at',{ascending:false}).limit(1).single();if(record.error)throw record.error;recordId=record.data.id;
 const doc=await db.from('source_documents').select('id,extracted_text').eq('source_record_id',recordId).single();if(doc.error)throw doc.error;docId=doc.data.id;
 storedBytes=Buffer.from(`<html lang="ca"><body>${doc.data.extracted_text}</body></html>`);
 await archiveSource(db,{id:docId,source_record_id:recordId,url:'https://fixture.invalid/annex',content_hash:null},{bytes:storedBytes,mimeType:'text/html'});
 code=doc.data.extracted_text.match(/Servei ([0-9.]+)\. Període/)[1];
 quotes=[`Entitat de prova A. Centre A. Servei ${code}. Període 2026. Import 3000 euros.`,`Entitat de prova B. Servei ${code}. Període 2026, import no acreditat.`];
});
test.afterAll(async()=>{
 if(!recordId)return;
 const objects=await db.storage.from(SOURCE_BUCKET).list(`cases/${recordId}/documents/${docId}`);if(objects.error)throw objects.error;
 const units=await db.from('record_units').select('storage_path').eq('source_record_id',recordId).not('storage_path','is',null);if(units.error)throw units.error;
 const paths=[...(objects.data??[]).map(item=>`cases/${recordId}/documents/${docId}/${item.name}`),...(units.data??[]).map(unit=>unit.storage_path as string)];
 if(paths.length){const removed=await db.storage.from(SOURCE_BUCKET).remove(paths);if(removed.error)throw removed.error;}
 cleanupUnitFixtures();
});
test('review two annex rows in the UI and download the actual two-row Excel',async({page})=>{
 await page.request.post('/api/access/login',{form:{password:'local-workflow-fixture-only',next:'/batches'}});
 await page.goto(`/records/${recordId}`);
 const section=page.locator('#unitats');await expect(section.getByRole('heading',{name:'Unitats del concert · detall de l’annex'})).toBeVisible();
 for(let i=0;i<2;i++){
  const entity=`Entitat de prova ${i?'B':'A'}`;
  await section.getByLabel('Entitat beneficiària',{exact:true}).fill(entity);
  await section.getByLabel('Centre',{exact:true}).fill(`Centre ${i?'B':'A'}`);
  await section.getByLabel('Període acreditat').fill('2026');
  await section.getByRole('combobox',{name:'Servei de Cartera',exact:true}).selectOption(code);
  await section.getByRole('combobox',{name:'Document',exact:true}).selectOption(docId);
  await section.getByLabel('Import individual acreditat (€)',{exact:true}).fill(i?'':'3000');
  await section.getByLabel('Pàgina de l’annex').fill('1');
  await section.getByLabel('Cita literal de la fila i del codi de servei').fill(quotes[i]);
  await section.getByRole('button',{name:'Afegir unitat pendent de revisió'}).click();
  const unit=section.getByRole('article').filter({has:page.getByRole('heading',{name:new RegExp(entity)})});
  await expect(unit).toBeVisible({timeout:30_000});
  await expect(unit.getByRole('link',{name:'Obre la còpia arxivada'})).toBeVisible();
  const row=await db.from('record_units').select('id,storage_path,storage_sha256,document_id').eq('source_record_id',recordId).eq('provider_name',entity).single();if(row.error)throw row.error;
  expect(row.data.storage_path).toMatch(new RegExp(`^cases/${recordId}/items/${row.data.id}/documents/${docId}/[a-f0-9]{64}\\.html$`));
  expect(row.data.storage_sha256).toBe(sha256(storedBytes));expect(row.data.document_id).toBe(docId);
  const stored=await db.storage.from(SOURCE_BUCKET).download(row.data.storage_path);if(stored.error||!stored.data)throw stored.error??Error('Storage copy missing');
  expect(Buffer.from(await stored.data.arrayBuffer())).toEqual(storedBytes);
  const opened=await page.request.get(`/api/records/${recordId}/units/${row.data.id}/source`);expect(opened.status()).toBe(200);expect(await opened.body()).toEqual(storedBytes);
  expect(opened.headers()['content-security-policy']).toContain('sandbox');
  if(i===0){
   const removed=await db.storage.from(SOURCE_BUCKET).remove([row.data.storage_path]);if(removed.error)throw removed.error;
   const job=await db.from('pipeline_jobs').select('id').eq('source_record_id',recordId).order('created_at',{ascending:false}).limit(1).single();if(job.error)throw job.error;
   const rejected=await db.rpc('review_record_unit',{p_unit:row.data.id,p_expected_job:job.data.id,p_approve:true,p_note:'Aprovació de prova amb font absent'});
   expect(rejected.error?.message).toContain('UNIT_SOURCE_NOT_ARCHIVED');
   const source=await db.from('source_documents').select('storage_path').eq('id',docId).single();if(source.error)throw source.error;
   const restored=await db.storage.from(SOURCE_BUCKET).copy(source.data.storage_path,row.data.storage_path);if(restored.error)throw restored.error;
  }
  await unit.getByLabel('Justificació de la unitat').fill('Validació humana de la fila acreditada de l’annex');
  await unit.getByRole('button',{name:'Aprovar unitat',exact:true}).click();
  await expect(unit).toContainText('Aprovada',{timeout:30_000});
 }
 await expect(section.getByRole('article')).toHaveCount(2);
 const provisions=await db.from('service_provisions').select('id,amount').eq('source_record_id',recordId).is('superseded_at',null);if(provisions.error)throw provisions.error;
 expect(provisions.data).toHaveLength(2);
 const response=await page.request.post('/api/exports/approved',{data:{provisionIds:provisions.data.map(p=>p.id)}});expect(response.status()).toBe(200);
 const book=new ExcelJS.Workbook();await book.xlsx.load(Uint8Array.from(await response.body()).buffer);const sheet=book.getWorksheet('Detalle_Provisiones')!;
 expect(sheet.rowCount).toBe(3);expect([sheet.getCell('H2').value,sheet.getCell('H3').value].sort()).toEqual([3000,null].sort());
 expect(sheet.getCell('N2').value).not.toBe(sheet.getCell('N3').value);
 const first=await db.from('record_units').select('id,storage_path').eq('source_record_id',recordId).eq('provider_name','Entitat de prova A').single();if(first.error)throw first.error;
 const removed=await db.storage.from(SOURCE_BUCKET).remove([first.data.storage_path]);if(removed.error)throw removed.error;
 const corrupted=Buffer.from('còpia alterada');
 const uploaded=await db.storage.from(SOURCE_BUCKET).upload(first.data.storage_path,corrupted,{contentType:'text/html',upsert:false});if(uploaded.error)throw uploaded.error;
 const persisted=await db.storage.from(SOURCE_BUCKET).download(first.data.storage_path);if(persisted.error||!persisted.data)throw persisted.error??Error('Corrupt fixture missing');
 expect(Buffer.from(await persisted.data.arrayBuffer())).toEqual(corrupted);
 const blocked=await page.request.get(`/api/records/${recordId}/units/${first.data.id}/source`);expect(blocked.status()).toBe(503);
 await page.screenshot({path:`docs/local/implementation-20260930/concert-${test.info().project.name}.png`,fullPage:true});
});
