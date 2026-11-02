import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import ExcelJS from 'exceljs';

// This invokes the actual GET with a synthetic report and rereads the XLSX.
// ExcelJS does not expose D2's comment again when D2 is an empty cell; the
// pending explanation is therefore asserted in visible column G instead.
test('outside GET exports conveni pending explanation without changing other financing amounts',async()=>{
 const dir=mkdtempSync(join(resolve('tests'),'.outside-route-test-'));
 try {
  const stub=join(dir,'report.ts'),bundle=join(dir,'route.cjs');
  writeFileSync(stub,`export async function classificationReport(){return {total:3,rows:[
   {source_records:{source_record_id:'conveni',source_dataset:'convenis',financing_type:'conveni',amount:300},explanation:'Original',evidence:[]},
   {source_records:{source_record_id:'grant',source_dataset:'raisc_local',financing_type:'subvencio',amount:120},explanation:'Grant',evidence:[]},
   {source_records:{source_record_id:'award',source_dataset:'contractacions',financing_type:'contractacio',amount:0,contract_verified_award:0},explanation:'Award',evidence:[]}]};}`);
  const require=createRequire(import.meta.url);
  await build({entryPoints:['app/api/exports/outside/route.ts'],bundle:true,platform:'node',format:'cjs',outfile:bundle,
   packages:'external',alias:{'@/lib/classification-report':stub,'@':resolve('.')},logLevel:'silent'});
  const response:Response=await require(bundle).GET();assert.equal(response.status,200);
  assert.match(response.headers.get('content-type')??'',/spreadsheetml/);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await response.arrayBuffer());
  const sheet=workbook.getWorksheet('Fora de cartera');assert.ok(sheet);
  assert.equal(sheet.getCell('D2').value,null);
  assert.match(String(sheet.getCell('G2').value),/^Original\n.*import queda pendent/);
  assert.equal(sheet.getCell('D3').value,120);assert.equal(sheet.getCell('G3').value,'Grant');
  assert.equal(sheet.getCell('D4').value,0);assert.equal(sheet.getCell('G4').value,'Award');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
