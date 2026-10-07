import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {archiveHistoricalWorkbook,archiveHistoricalRow,archiveHistoricalApiReport,archiveHistoricalApiRow,archiveHistoricalMasterRow,sha256,SOURCE_BUCKET} from '../../lib/source-storage';

let db:SupabaseClient,workbookBytes:Buffer,reportBytes:Buffer;
let excelId='',concertId='',masterId='';
const paths:string[]=[];
const marker=`HISTSTORE-${randomUUID()}`;

test.beforeAll(async()=>{
 const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
 if(status.API_URL!=='http://127.0.0.1:55421')throw Error('Only isolated local Storage allowed');
 db=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const book=new ExcelJS.Workbook();book.addWorksheet('Convenios').addRows([['Número conveni definitiu','Títol conveni'],[marker,'Conveni de prova']]);
 book.addWorksheet('Tabla (resumen)').getRow(4).values=[marker,'Servei mestre de prova'];
 workbookBytes=Buffer.from(await book.xlsx.writeBuffer());
 const workbook=await archiveHistoricalWorkbook(db,workbookBytes);paths.push(workbook.path);
 const payload={'Número conveni definitiu':marker,'Títol conveni':'Conveni de prova'};
 const source=await db.from('source_records').insert({source_dataset:'convenis',source_record_id:marker,mechanism:'Conveni',title:'Conveni de prova',processing_status:'pendent',source_file:'Conveni de prova.xlsx',source_sheet:'Convenios',source_row:2,source_payload:payload,source_payload_hash:sha256(Buffer.from(JSON.stringify(payload)))}).select('id,source_dataset,source_record_id,source_file,source_sheet,source_row,source_payload,source_payload_hash').single();
 if(source.error)throw source.error;excelId=source.data.id;
 const archivedExcel=await archiveHistoricalRow(db,source.data,workbook);paths.push(archivedExcel.path);

 const apiPayload={id_edicte:marker,titol:'Concert de prova'};
 reportBytes=Buffer.from(JSON.stringify({records:[apiPayload]}));
 const report=await archiveHistoricalApiReport(db,reportBytes);paths.push(report.path);
 const concert=await db.from('source_records').insert({source_dataset:'concerts',source_record_id:`etauler:1:${marker}`,mechanism:'Concert social / gestió delegada',title:'Concert de prova',processing_status:'pendent',source_file:'https://tauler.seu-e.cat/api/edictes',source_sheet:'edictes',source_row:2,source_payload:apiPayload,source_payload_hash:sha256(Buffer.from(JSON.stringify(apiPayload)))}).select('id,source_dataset,source_record_id,source_file,source_sheet,source_row,source_payload,source_payload_hash').single();
 if(concert.error)throw concert.error;concertId=concert.data.id;
 const archivedApi=await archiveHistoricalApiRow(db,concert.data,report);paths.push(archivedApi.path);

 const masterPayload={'Código Cartera':marker,'Nombre del servicio':'Servei mestre de prova'};
 const master=await db.from('master_services').insert({service_code:marker,service_name:'Servei mestre de prova',sector_scope:'social',portfolio_status:'pendent',source_file:'Conveni de prova.xlsx',source_sheet:'Tabla (resumen)',source_row:4,source_payload:masterPayload,source_payload_hash:sha256(Buffer.from(JSON.stringify(masterPayload)))}).select('id,source_file,source_sheet,source_row,source_payload,source_payload_hash').single();
 if(master.error)throw master.error;masterId=master.data.id;
 const archivedMaster=await archiveHistoricalMasterRow(db,master.data,workbook);paths.push(archivedMaster.path);
});
test.afterAll(async()=>{
 if(db){
  if(paths.length){const removed=await db.storage.from(SOURCE_BUCKET).remove(paths);if(removed.error)throw removed.error;}
  if(excelId||concertId){const removed=await db.from('source_records').delete().in('id',[excelId,concertId].filter(Boolean));if(removed.error)throw removed.error;}
  if(masterId){const removed=await db.from('master_services').delete().eq('id',masterId);if(removed.error)throw removed.error;}
 }
});

test('historical Excel, API and Master sources download from local Storage',async({page})=>{
 await page.request.post('/api/access/login',{form:{password:'local-workflow-fixture-only',next:'/records'}});
 const excel=await page.request.get(`/api/records/${excelId}/import-source`);
 expect(excel.status()).toBe(200);expect(sha256(await excel.body())).toBe(sha256(workbookBytes));
 const api=await page.request.get(`/api/records/${concertId}/import-source`);
 expect(api.status()).toBe(200);expect(api.headers()['content-type']).toContain('application/json');
 const row=JSON.parse((await api.body()).toString());expect(row).toMatchObject({kind:'historical_api_reconciliation',record_id:concertId,source_payload:{id_edicte:marker}});
 const master=await page.request.get(`/api/catalog/master/${masterId}/source`);
 expect(master.status()).toBe(200);expect(sha256(await master.body())).toBe(sha256(workbookBytes));
 await page.goto(`/records/${excelId}`);
 await expect(page.getByRole('link',{name:'Descarrega la font original arxivada'})).toBeVisible();
 await page.goto(`/catalog/master/${masterId}`);
 await expect(page.getByRole('link',{name:'Descarrega el llibre original arxivat'})).toBeVisible();
});
