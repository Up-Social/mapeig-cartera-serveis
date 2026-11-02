// Invoked only by the isolated SQL/Excel integration test. Input is synthetic.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {adaptBatchExportSnapshot} from '../lib/batch-export-snapshot';
import {createProvisionExcel} from '../lib/provision-excel';

async function main(){
 const baseline=process.memoryUsage().rss;
 const raw=readFileSync(0,'utf8');const data=adaptBatchExportSnapshot(JSON.parse(raw))!;
 if(process.argv.includes('--size')){
  assert.equal(data.rows.length,1002);
  const afterParse=process.memoryUsage().rss;
  const bytes=await createProvisionExcel(data.rows,{reviewWarnings:data.reviewWarnings});
  const afterBuild=process.memoryUsage().rss;
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  assert.equal(workbook.getWorksheet('Detalle_Provisiones')!.rowCount,1003);
  console.log(`SYNTHETIC_SIZE json_utf8_bytes=${Buffer.byteLength(raw)} xlsx_bytes=${bytes.byteLength} rss_before=${baseline} rss_after_parse=${afterParse} rss_after_build=${afterBuild} rss_after_read=${process.memoryUsage().rss}`);
  return;
 }
 assert.equal(data.rows.length,2);
 assert.equal(data.reviewWarnings.length,1);
 const bytes=await createProvisionExcel(data.rows,{reviewWarnings:data.reviewWarnings});
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
 const sheet=workbook.getWorksheet('Detalle_Provisiones')!,warnings=workbook.getWorksheet('Estado_Revision')!;
 assert.equal(sheet.rowCount,3);assert.equal(sheet.columnCount,18);
 assert.equal(sheet.getCell('A2').value,'source');assert.equal(sheet.getCell('A3').value,'second');
 assert.deepEqual(sheet.getCell('B2').value,{text:'https://example.invalid/annex',hyperlink:'https://example.invalid/annex'});
 assert.equal((sheet.getCell('G2').value as Date).toISOString(),'2026-09-30T00:00:00.000Z');
 assert.equal(sheet.getCell('G3').value,null);assert.equal(sheet.getCell('H2').value,500);assert.equal(sheet.getCell('H3').value,null);
 assert.equal(sheet.getCell('M2').value,'Synthetic');assert.equal(sheet.getCell('M3').value,'Synthetic');
 assert.equal(warnings.getCell('A3').value,'Registro a4000000-0000-4000-8000-000000000002: 1 líneas pendientes de revisión.');
 console.log(`PASS: synthetic PostgreSQL snapshot produced and re-opened ${bytes.byteLength} XLSX bytes`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
