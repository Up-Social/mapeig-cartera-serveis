import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createOutsideExportWorkbook,OUTSIDE_POPULATION_NOTE} from '../lib/outside-export-workbook';
import {OUTSIDE_AMOUNT_NOTE} from '../lib/outside-export-amount';

test('outside XLSX preserves the legacy sheet, columns, row coordinates and values including zero',async()=>{
 const {workbook,sheet}=createOutsideExportWorkbook();
 const headers=['Identificador','Servei descrit','Destinataris','Import','Font','Documents','Justificació automàtica','Revisió humana','Versió normativa','Evidència'];
 const rows=[
  ['synthetic-zero','Servei sintètic','Població proposada',0,'contractacions','https://example.invalid/document','Proposta automàtica','Nota humana conservada','synthetic-version','[{"content":"Fragment sintètic"}]'],
  ['synthetic-absent','Servei sintètic',null,null,'raisc_local',null,'Proposta automàtica',null,'synthetic-version','[]'],
  ['synthetic-long','Servei sintètic','Població proposada extensa. '.repeat(40),125.5,'convenis',null,'Proposta automàtica','Revisió','synthetic-version','[]'],
 ];
 rows.forEach(row=>sheet.addRow(row));
 const original=JSON.stringify(rows);
 const bytes=await workbook.xlsx.writeBuffer();const read=new ExcelJS.Workbook();await read.xlsx.load(bytes);
 assert.deepEqual(read.worksheets.map(s=>s.name),['Fora de cartera']);
 const restored=read.getWorksheet('Fora de cartera')!;
 assert.equal(restored.columnCount,10);assert.equal(restored.rowCount,4);
 assert.deepEqual(Array.from({length:10},(_,i)=>restored.getCell(1,i+1).value),headers);
 rows.forEach((row,index)=>assert.deepEqual(Array.from({length:10},(_,i)=>restored.getCell(index+2,i+1).value),row));
 assert.equal(restored.getCell('D2').value,0);assert.equal(JSON.stringify(rows),original);
 const note=restored.getCell('C1').note;
 const text=typeof note==='string'?note:note?.texts?.map(part=>part.text).join('');
 assert.equal(text,OUTSIDE_POPULATION_NOTE);
 assert.match(text!,/anàlisi automàtica/);assert.match(text!,/no acredita automàticament/);
 const amountNote=restored.getCell('D1').note;
 assert.equal(typeof amountNote==='string'?amountNote:amountNote?.texts?.map(part=>part.text).join(''),OUTSIDE_AMOUNT_NOTE);
 for(let row=1;row<=4;row++)for(let col=1;col<=10;col++)if(row!==1||(col!==3&&col!==4))assert.equal(restored.getCell(row,col).note,undefined);
});
