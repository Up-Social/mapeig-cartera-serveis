import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createProvisionExcel,type ProvisionExcelRow} from '../lib/provision-excel';
test('multiple reviewed units export distinct lines, traceable IDs and no repeated global amount',async()=>{
 const base:ProvisionExcelRow={source_id:'CONCERT-2026-1',call_url:'https://tauler.seu-e.cat/annex.pdf',regulatory_basis_url:null,provider_name:'Entitat A',provider_nif:null,mechanism:'Concert',award_date:'2026-09-30',amount:3000,contracting_body:'Administració',target_population:'Persones ateses',source_reference:'concerts:1',service_code:'1.1.2.1',service_name:'Ajuda a domicili',unit_id:'unit-a',centre:'Centre A',period:'2026',act_type:'award',annex_reference:'annex.pdf · p. 12'};
 const bytes=await createProvisionExcel([base,{...base,provider_name:'Entitat B',unit_id:'unit-b',amount:null,centre:'Centre B',annex_reference:'annex.pdf · p. 13'}]);
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(Uint8Array.from(bytes).buffer);const sheet=wb.getWorksheet('Detalle_Provisiones')!;
 assert.equal(sheet.rowCount,3);assert.equal(sheet.columnCount,18);
 assert.equal(sheet.getCell('A2').value,sheet.getCell('A3').value);
 assert.equal(sheet.getCell('N2').value,'unit-a');assert.equal(sheet.getCell('N3').value,'unit-b');
 assert.equal(sheet.getCell('H2').value,3000);assert.equal(sheet.getCell('H3').value,null);
 assert.equal(sheet.getCell('D3').value,'Entitat B');assert.equal(sheet.getCell('R3').value,'annex.pdf · p. 13');
 assert.deepEqual(sheet.getCell('B2').value,{text:base.call_url,hyperlink:base.call_url});
});
test('partial export states pending lines without turning unknown amounts into zero',async()=>{
 const row:ProvisionExcelRow={source_id:'CONCERT-1',call_url:null,regulatory_basis_url:null,provider_name:'Entitat A',provider_nif:'G00000000',mechanism:'Concert',award_date:null,amount:null,contracting_body:null,target_population:null,source_reference:'concerts:1',service_code:'1.1.2.1',service_name:'Ajuda a domicili',unit_id:'unit-a',act_type:'award'};
 const bytes=await createProvisionExcel([row],{reviewWarnings:['Registro concert-1: 41 líneas pendientes de revisión.']});
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(Uint8Array.from(bytes).buffer);
 assert.equal(wb.getWorksheet('Detalle_Provisiones')?.getCell('H2').value,null);
 assert.match(String(wb.getWorksheet('Estado_Revision')?.getCell('A2').value),/solo incluye las líneas aprobadas/);
 assert.match(String(wb.getWorksheet('Estado_Revision')?.getCell('A3').value),/41 líneas pendientes/);
});
