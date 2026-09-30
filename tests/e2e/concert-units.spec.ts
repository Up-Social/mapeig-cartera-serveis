import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
let db:SupabaseClient;let recordId='';let docId='';let code='';let quotes:string[]=[];
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
 code=doc.data.extracted_text.match(/Servei ([0-9.]+)\. Període/)[1];
 quotes=[`Entitat de prova A. Centre A. Servei ${code}. Període 2026. Import 3000 euros.`,`Entitat de prova B. Servei ${code}. Període 2026, import no acreditat.`];
});
test.afterAll(async()=>{
 if(!recordId)return;
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
 await page.screenshot({path:`docs/local/implementation-20260930/concert-${test.info().project.name}.png`,fullPage:true});
});
