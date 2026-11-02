import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractConcertChangeRows,operativeConcertChange} from '../lib/concerts/change-extraction';
test('official Girona minoration retains two negative amounts, not the monthly tariff',()=>{
 const rows=extractConcertChangeRows(readFileSync('tests/fixtures/official/girona-minoration-2026.txt','utf8'));
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.amountCents),[-531167,-531167]);assert.deepEqual(rows.map(r=>r.quantityDelta),[-1,-1]);
 assert.deepEqual(rows.map(r=>r.resesCode),['S08875','S00888']);assert.ok(rows.every(r=>r.observedServiceCode==='1.2.6.2.4.1.1'&&r.page===4));
});
test('official Mercè Pla transfer retains both establishments and nets zero',()=>{
 const rows=extractConcertChangeRows(readFileSync('tests/fixtures/official/merce-pla-transfer-2024.txt','utf8'));
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.amountCents),[-8166528,8166528]);assert.deepEqual(rows.map(r=>r.resesCode),['S02092','S11212']);assert.equal(rows.reduce((s,r)=>s+r.amountCents,0),0);
});
test('incomplete identities and tariff-only rows are not invented as changes',()=>{
 assert.deepEqual(extractConcertChangeRows('Annex cost places\nS01150 758,81 €'),[]);
});

test('generic titles use the operative reduction, not background awards',()=>{
 assert.equal(operativeConcertChange('Antecedents: assignar places.\nRESOLC:\n1. Reduir les places del servei.\n2. Notificar.'),'modification');
 assert.equal(operativeConcertChange('Antecedents: reduir places.\nRESOLC:\n1. Assignar el servei.'),null);
});

// S1-1's actual column positions and wrapped centre, with synthetic identities.
const columns=(cells:Array<[number,string]>)=>cells.reduce((line,[start,value])=>{
 assert.ok(line.length<=start,'fixture columns must not overlap');return line.padEnd(start,' ')+value;
},'');
const centreHeader=columns([[27,'gestor'],[61,'NIF entitat'],[132,'Codi S'],[142,'Nom servei'],[155,'pressupostària']]);
const centreRow=(name='Carme',nif='G12345678',reses='S01234')=>columns([[50,'Entitat'],[61,nif],[77,'1.2.6.2.3.2.4'],[94,'suport extens'],[132,reses],[142,name],[155,'D/0000'],[177,'2025'],[220,'1 1.640,16 €']]);
const centrePrefix=[columns([[94,'Servei de llar residència']]),columns([[94,'persones destinatàries'],[142,'Residència']]),columns([[50,'Fundació'],[94,'amb necessitat de'],[142,'Mare']])];
const centreDocument=(body:string[],header=centreHeader)=>['## Pàgina 4','Annex','cost places',header,...body,'Total general'].join('\n');

test('S1-1 layout adds a page-local centre observation without changing the existing anchor',()=>{
 const line=centreRow(),subtotal=columns([[27,'BE2151'],[220,'1 1.640,16 €']]);
 const text=centreDocument([subtotal,...centrePrefix,line]);
 const [row]=extractConcertChangeRows(text);
 const {centreObservation:observation,...legacy}=row;
 assert.deepEqual(legacy,{page:4,row:1,nif:'G12345678',resesCode:'S01234',observedServiceCode:'1.2.6.2.3.2.4',amountCents:164016,quantityDelta:1,quote:line.trim().replace(/\s+/g,' ')});
 assert.equal(observation?.centre,'Residència Mare Carme');
 assert.equal(observation?.kind,'printed_service_name_candidate');
 assert.equal(observation?.blockQuote,[...centrePrefix,line].join('\n'));
 assert.ok(text.includes(observation!.blockQuote));assert.ok(text.includes(observation!.headerQuote));
 assert.equal(observation?.columnStart,142);assert.equal(observation?.columnEnd,155);
});

test('missing, duplicate, shifted and tabbed headers leave the optional centre unknown',()=>{
 for(const header of [centreHeader.replace('Nom servei','Centre'),centreHeader+' Nom servei',centreHeader.replace('Codi S','Codi X'),centreHeader.replace('Nom servei',' Nom servei'),centreHeader+'\t',centreHeader+' 🏠']){
  const [row]=extractConcertChangeRows(centreDocument([...centrePrefix,centreRow()],header));
  assert.equal(row.centreObservation,undefined,header);assert.equal(row.amountCents,164016);
 }
});

test('neighbouring rows require a separator and cannot lend centre fragments to another identity',()=>{
 const first=centreRow('Primer'),second=centreRow('Segon','G87654321','S04321');
 const ambiguous=extractConcertChangeRows(centreDocument([first,columns([[142,'continuació']]),second]));
 assert.equal(ambiguous.length,2);assert.ok(ambiguous.every(row=>!row.centreObservation));
 const separated=extractConcertChangeRows(centreDocument([first,'',second]));
 assert.deepEqual(separated.map(row=>row.centreObservation?.centre),['Primer','Segon']);
 assert.ok(!separated[1].centreObservation!.blockQuote.includes('Primer'));
 const twoIdentities=extractConcertChangeRows(centreDocument([centreRow().replace('D/0000','S09999')]));
 assert.equal(twoIdentities[0].centreObservation,undefined);
});

test('centre observations never inherit a header or text from the previous page',()=>{
 const text=centreDocument(centrePrefix)+'\n## Pàgina 5\nAnnex cost places\n'+centreRow();
 const [row]=extractConcertChangeRows(text);
 assert.equal(row.page,5);assert.equal(row.centreObservation,undefined);
 const repeated=centreDocument([centreRow('Primer')])+'\n'+centreDocument([centreRow('Segon','G87654321','S04321')]).replace('Pàgina 4','Pàgina 5');
 const rows=extractConcertChangeRows(repeated);
 assert.deepEqual(rows.map(row=>row.centreObservation?.centre),['Primer',undefined]);
 assert.ok(!rows[0].centreObservation!.blockQuote.includes('## Pàgina'));
 const split=centreDocument(centrePrefix)+'\n'+centreDocument([centreRow()]).replace('Pàgina 4','Pàgina 5');
 assert.equal(extractConcertChangeRows(split)[0].centreObservation,undefined);
 const lateAnnex=['## Pàgina 4','cost places',centreHeader,centreRow(),'Annex'].join('\n');
 assert.equal(extractConcertChangeRows(lateAnnex)[0].centreObservation,undefined);
});

test('non-BMP text and trailing or excessive continuation keep the original financial observation only',()=>{
 const nonBmp=[...centrePrefix,centreRow().replace('Carme','C🏠rme')];
 const trailing=[...centrePrefix,centreRow(),columns([[142,'continuació']])];
 const long=[...Array.from({length:9},()=>columns([[142,'nom']])) ,centreRow()];
 for(const body of [nonBmp,trailing,long]){
  const [row]=extractConcertChangeRows(centreDocument(body));
  assert.equal(row.centreObservation,undefined);assert.equal(row.amountCents,164016);
 }
});
