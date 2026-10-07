import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {sha256,SOURCE_BUCKET} from '../../lib/source-storage';

let db:SupabaseClient,directory='',runId='',marker='';
const rows:Array<{id:string;source_file:string;source_sheet:string;source_row:number;storage_path:string;storage_sha256:string}>=[];
async function workbook(file:string,sheets:Array<{name:string;header:string[];data?:string[]}>) {
 const book=new ExcelJS.Workbook();
 for(const sheet of sheets){const tab=book.addWorksheet(sheet.name);tab.addRow(sheet.header);if(sheet.data)tab.addRow(sheet.data);}
 await book.xlsx.writeFile(path.join(directory,file));
}
test.beforeAll(async()=>{
 const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
 if(status.API_URL!=='http://127.0.0.1:55421')throw Error('Only isolated local Storage allowed');
 db=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 directory=await mkdtemp(path.join(tmpdir(),'storage-import-e2e-'));
 marker=`STOREIMP-${randomUUID()}`;
 await workbook('Contrataciones. Consolidado 2024-2026.xlsx',[{name:'Contrataciones',header:['Código del expediente','Denominación','Enlace de la última publicación'],data:[`${marker}-C`,'Contractació de prova','https://example.invalid/contracte']}]);
 await workbook('Convenios. Consolidado 2024-2026.xlsx',[{name:'Convenios',header:['Número conveni definitiu','Títol conveni'],data:[`${marker}-V`,'Conveni de prova']}]);
 await workbook('Subvenciones. RAISC Consolidado 2024-2026.xlsx',[{name:'CCAA',header:['Clau','Títol convocatòria català'],data:[`${marker}-S1`,'Subvenció autonòmica de prova']},{name:'Local',header:['Clau','Títol convocatòria català'],data:[`${marker}-S2`,'Subvenció local de prova']}]);
 await workbook('Master. Mapeo Cartera Serveis Socials.xlsx',[{name:'Tabla (resumen)',header:['Código Cartera']}]);
 execFileSync(process.execPath,['--import','tsx','scripts/import-excels.ts','--source-dir',directory,'--limit','1'],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY:status.SERVICE_ROLE_KEY,WORKFLOW_TEST_PROJECT:'cartera-workflow-test'},timeout:90_000});
 const imported=await db.from('source_records').select('id,source_file,source_sheet,source_row,import_run_id,storage_path,storage_sha256').like('source_record_id',`${marker}%`);
 if(imported.error)throw imported.error;
 expect(imported.data).toHaveLength(4);
 runId=imported.data[0].import_run_id;
 expect(imported.data.every(row=>row.import_run_id===runId)).toBe(true);
 rows.push(...imported.data);
});
test.afterAll(async()=>{
 if(db&&runId){
  const run=await db.from('import_runs').select('storage_manifest').eq('id',runId).single();
  const paths=[...rows.map(row=>row.storage_path),...Object.values(run.data?.storage_manifest??{}).map((entry)=>((entry as {path:string}).path))];
  const removed=await db.storage.from(SOURCE_BUCKET).remove(paths);if(removed.error)throw removed.error;
  const deleted=await db.from('source_records').delete().in('id',rows.map(row=>row.id));if(deleted.error)throw deleted.error;
  const runDeleted=await db.from('import_runs').delete().eq('id',runId);if(runDeleted.error)throw runDeleted.error;
 }
 if(directory)await rm(directory,{recursive:true,force:true});
});

test('each imported row has a case folder and a verifiable source workbook',async({page})=>{
 const run=await db.from('import_runs').select('storage_manifest').eq('id',runId).single();if(run.error)throw run.error;
 expect(Object.keys(run.data.storage_manifest)).toHaveLength(4);
 for(const row of rows){
  const archive=await db.storage.from(SOURCE_BUCKET).download(row.storage_path);if(archive.error||!archive.data)throw archive.error??Error('Case source missing');
  const bytes=Buffer.from(await archive.data.arrayBuffer());expect(sha256(bytes)).toBe(row.storage_sha256);
  const metadata=JSON.parse(bytes.toString());
  expect(metadata).toMatchObject({record_id:row.id,import_run_id:runId,source_file:row.source_file,source_sheet:row.source_sheet,source_row:row.source_row});
  expect(row.storage_path).toMatch(new RegExp(`^cases/${row.id}/imports/${runId}/[a-f0-9]{64}\\.json$`));
  const workbook=run.data.storage_manifest[row.source_file];expect(workbook.path).toBe(metadata.workbook.path);
  const stored=await db.storage.from(SOURCE_BUCKET).download(workbook.path);if(stored.error||!stored.data)throw stored.error??Error('Workbook missing');
  expect(sha256(Buffer.from(await stored.data.arrayBuffer()))).toBe(workbook.sha256);
 }
 await page.request.post('/api/access/login',{form:{password:'local-workflow-fixture-only',next:'/records'}});
 await page.goto(`/records/${rows[0].id}`);
 await expect(page.getByRole('link',{name:'Descarrega la font original arxivada'})).toBeVisible();
 const response=await page.request.get(`/api/records/${rows[0].id}/import-source`);expect(response.status()).toBe(200);
 expect(sha256(await response.body())).toBe(run.data.storage_manifest[rows[0].source_file].sha256);
});
