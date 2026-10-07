import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {extractConcertAnnexRows,extractProgram317Rows} from '../lib/concerts/annex-extraction';
import {concertCaseKeys} from '../lib/concerts/case-labels';
import {proposeRecordLinks,type ConcertPublication} from '../lib/concerts/record-linking';
import {proposeUnitLinks,type ConcertUnitForLink} from '../lib/concerts/unit-linking';

test('official Barcelona annex stays split by line, NIF and RESES and reconciles to 44 services',()=>{
 const text=execFileSync('pdftotext',['-layout','tests/fixtures/official/25-000163-AP-barcelona-etauler-605700.pdf','-'],{encoding:'utf8',maxBuffer:2_000_000});
 const rows=extractConcertAnnexRows(text);
 assert.equal(rows.length,42);
 assert.equal(rows.reduce((sum,row)=>sum+row.quantity,0),44);
 assert.equal(rows.reduce((sum,row)=>sum+row.amountCents,0),11334081);
 assert.equal(new Set(rows.map(row=>row.nif)).size,15);
 assert.equal(new Set(rows.map(row=>row.resesCode)).size,19);
 assert.ok(rows.some(row=>row.nif==='R5800417G'));
 assert.ok(rows.every(row=>row.page>=4&&row.page<=8));
 assert.equal(rows[0].observedProviderName,'ASPANIN, Associació Pro Persones amb Discapacitat Intel·lectual i les Seves Famílies');
 assert.equal(rows.find(row=>row.nif==='G59088120')?.observedProviderName,'Fundació Germà Tomàs Canet');
});

test('program annex keeps the printed entity and service separate from repeated financial columns',()=>{
 const lines=[
  ' '.repeat(42)+"Obra d’Integració"+' '.repeat(160)+"Centre residencial",
  ' '.repeat(42)+"Social \"OBINSO\""+' '.repeat(170)+"d’assistència als",
  ' '.repeat(27)+'G08458051'+' '.repeat(6)+'Social "OBINSO"'+' '.repeat(22)+'2600270759 1 456.244,47 € D/251000200/317E/0032 social 03200522 S01156 Castells Esparreguera drogodependents 6 173.681,64 €',
 ];
 const rows=extractProgram317Rows(lines.join('\n'));
 assert.equal(rows.length,1);
 assert.ok(rows[0].observedProviderName?.includes('OBINSO'));
 assert.equal('amountCents' in rows[0],false);
});

test('a territorial provision and a program renewal retain overlapping case badges',()=>{
 assert.deepEqual(concertCaseKeys('Resolució de l’expedient 25-000163-AP (Barcelona) per a la provisió directa',[]),['award','territorial']);
 assert.deepEqual(concertCaseKeys('Resolució de pròrroga i autorització de la despesa del programa 317',[]),['renewal','program_renewal']);
});

test('a publication amendment is only a candidate; equal expediente across territories is not a link',()=>{
 const rows:ConcertPublication[]=[
  {id:'original',title:'Resolució exp. 24-001-PN-DD-SS (Barcelona)',source_record_id:'etauler:1:483203',source_payload:{data_publicacio:'2024-05-01'}},
  {id:'amendment',title:'Resolució d’esmena de la Resolució exp. 24-001-PN-DD-SS (Barcelona)',source_record_id:'etauler:1:500760',source_payload:{data_publicacio:'2024-08-01',event_type:'esmena'}},
  {id:'other-territory',title:'Resolució exp. 24-001-PN-DD-SS (Lleida)',source_record_id:'etauler:1:other',source_payload:{data_publicacio:'2024-04-01'}},
 ];
 const links=proposeRecordLinks(rows).filter(link=>link.laterRecordId==='amendment');
 assert.deepEqual(links.map(link=>link.earlierRecordId),['original']);
 assert.equal(links[0].method,'expedient_territory');
 assert.match(links[0].evidence,/cal contrastar PDF, RESES i NIF/i);
});

test('a cited prior title plus RESES proposes the OBINSO correction without using disposition',()=>{
 const original='Resolució relativa al cessament voluntari de les 7 places del servei de centre residencial d’assistència a persones amb drogodependència, amb codi RESES S01150';
 const rows:ConcertPublication[]=[
  {id:'cessament',title:original,source_record_id:'etauler:1:525328',source_payload:{data_publicacio:'2024-10-16'}},
  {id:'esmena',title:`Resolució d’esmena de la ${original}, que se li van assignar a OBINSO`,source_record_id:'etauler:1:529960',source_payload:{data_publicacio:'2024-11-05'}},
 ];
 const links=proposeRecordLinks(rows);
 assert.equal(links.length,1);
 assert.equal(links[0].earlierRecordId,'cessament');
 assert.equal(links[0].method,'explicit_resolution');
 assert.match(links[0].evidence,/cal contrastar el PDF/);
});

test('RESES and NIF propose only a compatible line; disposition is irrelevant',()=>{
 const base:ConcertUnitForLink={id:'base',recordId:'original',recordTitle:'Resolució DSO/4390/2023',recordExternalId:'etauler:1:1',publishedAt:'2024-01-01',actType:'award',resesCode:'S01150',providerNif:'G08458051',serviceCode:'1.2.7.3',territory:'Barcelona',originReference:null,period:'2024'};
 const later:ConcertUnitForLink={...base,id:'later',recordId:'change',publishedAt:'2024-07-01',actType:'amendment',period:'2025'};
 const otherService:ConcertUnitForLink={...base,id:'other-service',serviceCode:'1.2.7.5'};
 const otherTerritory:ConcertUnitForLink={...base,id:'other-territory',territory:'Lleida'};
 const links=proposeUnitLinks([base,otherService,otherTerritory,later]);
 assert.deepEqual(links.map(link=>link.earlierUnitId),['base']);
 assert.equal(links[0].method,'reses_nif');
});

test('a cession with a changed NIF requires an explicit cited original',()=>{
 const base:ConcertUnitForLink={id:'base',recordId:'original',recordTitle:'Resolució DSO/4390/2023',recordExternalId:'etauler:1:1',publishedAt:'2024-01-01',actType:'award',resesCode:'S01150',providerNif:'G08458051',serviceCode:'1.2.7.3',territory:'Barcelona',originReference:null,period:'2024'};
 const cession:ConcertUnitForLink={...base,id:'cession',recordId:'change',publishedAt:'2024-09-01',actType:'cession',providerNif:'G99999999',originReference:null};
 assert.equal(proposeUnitLinks([base,cession]).length,0);
 assert.equal(proposeUnitLinks([base,{...cession,originReference:'DSO/4390/2023'}])[0].method,'explicit_resolution');
});
