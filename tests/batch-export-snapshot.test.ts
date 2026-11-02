import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {adaptBatchExportSnapshot} from '../lib/batch-export-snapshot';
import {createProvisionExcel} from '../lib/provision-excel';

const id=(n:number)=>`a4000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(){
 const row={id:id(3),source_record_id:id(2),source_id:'case-1',unit_id:id(6),centre:'Centre',period:'2026',act_type:'award',annex_reference:'Annex p. 2',
  call_url:'https://example.invalid/annex',regulatory_basis_url:null,provider_name:'Entitat',provider_nif:null,mechanism:'Concert',award_date:'2026-09-30',amount:0,
  contracting_body:'Ajuntament',target_population:'Infància',source_reference:'fixture/1',service_code:'1.2',
  official_services:{service_name:'Servei oficial'},master_services:{service_name:'Servei Master'}};
 return {fingerprint:'batch-export-v1:'+'a'.repeat(64),body:{schema_version:1,run:{id:id(1),batch_number:5,status:'completed'},
  jobs:[{id:id(7),source_record_id:id(2)},{id:id(8),source_record_id:id(4)}],record_ids:[id(2),id(4)],
  provisions:[{...row,id:id(5),source_record_id:id(4),source_id:'case-2',unit_id:id(9),amount:null,award_date:null,official_services:null},row],
  pending_units:[{id:id(10),source_record_id:id(2)},{id:id(11),source_record_id:id(2)},{id:id(12),source_record_id:id(4)}]}};
}
test('snapshot adapter generates a real Excel preserving fields, names, dates, nulls, zero and pending warnings',async()=>{
 const oldTZ=process.env.TZ;process.env.TZ='Europe/Madrid';
 try{
  const input=fixture(),data=adaptBatchExportSnapshot(input)!;
  assert.equal(data.rows.length,2);assert.equal(data.fingerprint,input.fingerprint);
  const bytes=await createProvisionExcel(data.rows,{reviewWarnings:data.reviewWarnings});
  assert.equal(Buffer.from(bytes).subarray(0,2).toString(),'PK');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  const sheet=workbook.getWorksheet('Detalle_Provisiones')!,warnings=workbook.getWorksheet('Estado_Revision')!;
  assert.equal(sheet.rowCount,3);assert.equal(sheet.columnCount,18);
  assert.equal(sheet.getCell('A2').value,'case-1');assert.equal(sheet.getCell('A3').value,'case-2');
  assert.deepEqual(sheet.getCell('B2').value,{text:'https://example.invalid/annex',hyperlink:'https://example.invalid/annex'});
  assert.equal(sheet.getCell('C2').value,null);assert.equal(sheet.getCell('D2').value,'Entitat');assert.equal(sheet.getCell('E2').value,null);
  assert.equal(sheet.getCell('F2').value,'Concert');
  assert.equal((sheet.getCell('G2').value as Date).toISOString(),'2026-09-30T00:00:00.000Z');
  assert.equal(sheet.getCell('G3').value,null);assert.equal(sheet.getCell('H2').value,0);assert.equal(sheet.getCell('H3').value,null);
  assert.equal(sheet.getCell('I2').value,'Ajuntament');assert.equal(sheet.getCell('J2').value,'Infància');
  assert.equal(sheet.getCell('K2').value,'fixture/1');assert.equal(sheet.getCell('L2').value,'1.2');
  assert.equal(sheet.getCell('M2').value,'Servei oficial');assert.equal(sheet.getCell('M3').value,'Servei Master');
  assert.equal(sheet.getCell('N2').value,id(6));assert.equal(sheet.getCell('O2').value,'Centre');assert.equal(sheet.getCell('P2').value,'2026');
  assert.equal(sheet.getCell('Q2').value,'award');assert.equal(sheet.getCell('R2').value,'Annex p. 2');
  assert.match(String(warnings.getCell('A2').value),/solo incluye las líneas aprobadas/);
  assert.equal(warnings.getCell('A3').value,`Registro ${id(2)}: 2 líneas pendientes de revisión.`);
  assert.equal(warnings.getCell('A4').value,`Registro ${id(4)}: 1 líneas pendientes de revisión.`);
 }finally{if(oldTZ===undefined)delete process.env.TZ;else process.env.TZ=oldTZ;}
});
test('adapter rejects malformed or cross-record snapshot without treating its fingerprint as proof of bytes',()=>{
 const b=fixture();
 assert.equal('bytesVerified' in adaptBatchExportSnapshot(b)!,false);
 assert.equal(adaptBatchExportSnapshot({...b,body:{schema_version:1,run:null,jobs:[],record_ids:[],provisions:[],pending_units:[]}}),null);
 assert.throws(()=>adaptBatchExportSnapshot({...b,body:{...b.body,run:null}}));
 assert.throws(()=>adaptBatchExportSnapshot({...b,body:{...b.body,record_ids:[id(2)]}}));
 assert.throws(()=>adaptBatchExportSnapshot({...b,body:{...b.body,pending_units:[{id:id(10),source_record_id:id(99)}]}}));
 assert.throws(()=>adaptBatchExportSnapshot({...b,body:{...b.body,provisions:[{...b.body.provisions[0],amount:'0'}]}}));
 assert.throws(()=>adaptBatchExportSnapshot({...b,fingerprint:'invalid'}));
});
