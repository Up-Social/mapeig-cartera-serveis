import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createProvisionExcel,type ProvisionExcelRow} from '../lib/provision-excel';
import {concertPopulationNotInformedCount} from '../lib/concerts/population-export-notice';

const base:ProvisionExcelRow={source_id:'synthetic',call_url:null,regulatory_basis_url:null,provider_name:'Entitat sintètica',provider_nif:null,mechanism:'Concert',award_date:'2026-01-01',amount:2300,contracting_body:null,target_population:null,source_reference:'synthetic',service_code:'1',service_name:'Servei sintètic',unit_id:'u1',act_type:'award'};
async function workbook(rows:ProvisionExcelRow[]){const bytes=await createProvisionExcel(rows);const wb=new ExcelJS.Workbook();await wb.xlsx.load(Uint8Array.from(bytes).buffer);return wb;}
test('approved and batch workbook preserves rows, amounts and columns and explains blank Concert population',async()=>{
 const rows=[{...base,source_records:{financing_type:'concert'}},{...base,source_id:'other',unit_id:'u2',amount:4500,target_population:'Persones grans',source_records:[{financing_type:'concert'}]}];
 const wb=await workbook(rows);const detail=wb.getWorksheet('Detalle_Provisiones')!,notes=wb.getWorksheet('Estado_Revision')!;
 assert.equal(detail.rowCount,3);assert.equal(detail.columnCount,18);assert.equal(detail.getCell('H2').value,2300);assert.equal(detail.getCell('H3').value,4500);
 assert.equal(detail.getCell('J2').value,null);assert.equal(detail.getCell('J3').value,'Persones grans');
 assert.match(String(notes.getCell('A3').value),/Población no informada en 1 registro de concierto/);
 assert.match(String(notes.getCell('A3').value),/Un campo vacío no identifica una decisión de revisión/);
 assert.match(String(notes.getCell('A3').value),/población informada en 1 registro de concierto puede corresponder al conjunto del expediente/);
 assert.doesNotMatch(String(notes.getCell('A2').value),/Exportación parcial/);
});
test('does not infer Concert from mechanism and does not change other types',async()=>{
 const rows=[{...base,source_records:{financing_type:'conveni'}},{...base,source_id:'untyped',source_records:null},{...base,source_id:'subsidy',source_records:[{financing_type:'subvencio'}]}];
 assert.equal(concertPopulationNotInformedCount(rows),0);const wb=await workbook(rows);
 assert.equal(wb.getWorksheet('Detalle_Provisiones')?.rowCount,4);assert.equal(wb.getWorksheet('Estado_Revision'),undefined);
});
test('blank or whitespace count only known Concerts without claiming review status',()=>{
 const rows=[{target_population:null,source_records:{financing_type:'concert'}},{target_population:'   ',source_records:[{financing_type:'concert'}]},{target_population:'Gent gran',source_records:{financing_type:'concert'}},{target_population:null,source_records:[]}];
 assert.equal(concertPopulationNotInformedCount(rows),2);
});

test('an informed Concert population stays unchanged but carries an attribution caveat',async()=>{
 const wb=await workbook([{...base,target_population:'Persones grans',source_records:{financing_type:'concert'}}]);
 assert.equal(wb.getWorksheet('Detalle_Provisiones')?.getCell('J2').value,'Persones grans');
 const notice=String(wb.getWorksheet('Estado_Revision')?.getCell('A3').value);
 assert.match(notice,/puede corresponder al conjunto del expediente/);
 assert.match(notice,/no acredita su atribución a cada línea/);
 assert.doesNotMatch(notice,/Población no informada/);
});
