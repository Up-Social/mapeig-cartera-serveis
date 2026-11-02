import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createConcertEvolutionExcel} from '../lib/concerts/export';
import {concertEvolution} from '../lib/concerts/evolution';

test('concert export separates movements, unknown balances and documented maxima',async()=>{
 const empty=concertEvolution({units:[],reviews:[],links:[],publications:[]},'2026-01-01');
 const result={...empty,balances:[{rootId:'root',rootIds:['root'],providerNif:'G12345678',provider:'Entitat',service:'Servei',territory:'Vic',period:'2026',funder:'Finançador',amountCents:null,maximum:true,issues:['Import pendent']}],movements:[{unitId:'unit',recordId:'record',rootId:'root',provider:'Entitat',operation:'delta' as const,period:'2026',effectiveAt:'2026-01-01',amountCents:0,amountKind:'exact' as const,status:'pending' as const,issues:['Revisió pendent']}],pending:1};
 const bytes=await createConcertEvolutionExcel(result,'2026-01-01','https://example.invalid');
 const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(bytes) as never);
 const balance=book.getWorksheet('Foto consolidada')!,movements=book.getWorksheet('Moviments i pendents')!;
 assert.equal(balance.getCell('G2').value,null);assert.equal(balance.getCell('H2').value,'Sí');assert.equal(balance.getCell('I2').value,'Import pendent');
 assert.equal(movements.getCell('H2').value,0);assert.equal(movements.getCell('J2').value,'Revisió pendent');
 assert.match(String(book.getWorksheet('Criteris')!.getCell('B4').value),/No s’han de sumar/);
});
