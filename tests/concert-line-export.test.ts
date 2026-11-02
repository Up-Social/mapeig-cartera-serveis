import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import ExcelJS from 'exceljs';
import {exportFrozenLines,type FrozenLine} from '../lib/concerts/line-export';
const base={source_id:'synthetic',call_url:null,regulatory_basis_url:null,provider_name:'Entitat',provider_nif:null,mechanism:'Concert',award_date:null,amount:12000,contracting_body:null,target_population:null,source_reference:'fixture',service_code:'1',service_name:'1'};
const lines=[{decision_id:'a',snapshot:base},{decision_id:'b',snapshot:{...base,amount:13000,target_population:'gent gran'}}] as FrozenLine[];
test('hashes real XLSX bytes and commits exact input before returning',async()=>{
 let committed=''; const result=await exportFrozenLines(lines,async(hash,expected)=>{committed=hash;assert.deepEqual(expected,lines);});
 assert.equal(committed,createHash('sha256').update(result.bytes).digest('hex'));
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(result.bytes) as never);
 const sheet=wb.getWorksheet('Detalle_Provisiones')!;assert.equal(Number(sheet.getRow(2).getCell(8).value)+Number(sheet.getRow(3).getCell(8).value),25000);
});
test('never returns bytes when receipt rejects or the snapshot becomes stale',async()=>{
 await assert.rejects(exportFrozenLines(lines,async()=>{throw new Error('ISOLATED_EXPORT_STALE')}),/ISOLATED_EXPORT_STALE/);
});
