import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {declaredGeneralAnnexQuantity,declaredGeneralAnnexTotal,extractColumnAnnexRows,extractColumnAnnexWithCoverage,extractConcertAnnexRows,extractProgram317Rows,extractEconomicAnnexRows} from '../lib/concerts/annex-extraction';
import {concertCaseKeys} from '../lib/concerts/case-labels';
import {concertTerritory,proposeRecordLinks,type ConcertPublication} from '../lib/concerts/record-linking';
import {proposeUnitLinks,type ConcertUnitForLink} from '../lib/concerts/unit-linking';
import {annexCandidateOrdinals,concertPopulations} from '../lib/cloud/concert-analysis';
import {splitText} from '../lib/pipeline/chunks';
import {selectEvidenceWindow} from '../lib/cloud/evidence-window';

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

test('an omitted service code can only inherit from a matching repeated table description on the same page',()=>{
 const make=(code:string,description:string,date:string,amount:string)=>[
  ' '.repeat(81)+description,
  ' '.repeat(36)+'Fundació Prova'.padEnd(19)+'G55112890'.padEnd(14)+code.padEnd(13)+'Mòdul C'.padEnd(37)+'S03694 Servei D/251 2600333093 1 Ripoll 0% 445,05 € '+date+' 31/12/2025 1 '+amount+' €',
 ];
 const header=' '.repeat(81)+'Nom tipologia de servei'.padEnd(37)+'Codi S';
 const first=make('1.2.6.2.6','Servei de suport a les persones','21/05/2025','3.276,28');
 const same=make('','Servei de suport a les persones','23/05/2025','3.247,02');
 const changed=make('','Una altra tipologia diferent','25/05/2025','3.000,00');
 const document=[header,...first,...same,...changed].join('\n');
 const rows=extractConcertAnnexRows(document);
 assert.equal(rows.length,2);
 assert.equal(rows[0].serviceCode,'1.2.6.2.6');
 assert.equal(rows[1].serviceCode,'1.2.6.2.6');
 assert.equal(rows[1].amountCents,324702);
 assert.ok(document.replace(/\s+/g,' ').includes(rows[1].quote));
 assert.equal(extractConcertAnnexRows([header,...first].join('\n')+'\f'+[header,...same].join('\n')).length,1);
 assert.equal(extractConcertAnnexRows([header,...first,'Annex 2',...same].join('\n')).length,1);
});

test('a generic annex total is accepted only when the operative maximum explicitly references that annex',()=>{
 const text='Resolc: indicar l’import econòmic de la provisió amb efectes per a l’any 2025, per un import total màxim de 6.523,30 € exempt d’IVA, tal com s’indica a l’Annex d’aquesta resolució.';
 assert.deepEqual(declaredGeneralAnnexTotal(text),{amountCents:652330,kind:'maximum'});
 assert.deepEqual(declaredGeneralAnnexTotal(text.replace('màxim de 6.523,30 €','màxim 6.523,30 euros')),{amountCents:652330,kind:'maximum'});
 assert.equal(declaredGeneralAnnexTotal('Import total màxim de 6.523,30 € en una convocatòria anterior.'),null);
 assert.equal(declaredGeneralAnnexTotal(text+' '+text.replace('6.523,30','7.000,00')),null);
 assert.equal(declaredGeneralAnnexQuantity(text+' Total\n general   2  6.523,30 €',652330),2);
 assert.equal(declaredGeneralAnnexQuantity(text+' Total\n general   2  6.500,00 €',652330),null);
 assert.equal(declaredGeneralAnnexQuantity(text,652330),null);
});

test('column annexes preserve a row without dates or any amount, without using a tariff as funding',()=>{
 const header='Nom entitat'.padEnd(25)+'NIF entitat'.padEnd(16)+'Codi cartera'.padEnd(15)+'Tipologia servei'.padEnd(33)+'Codi S'.padEnd(9)+'Nom servei'.padEnd(25)+'Municipi'.padEnd(20)+'assignar';
 const row='Fundació Prova'.padEnd(25)+'G12345678'.padEnd(16)+'1.2.6.2.4.1'.padEnd(15)+'Servei ocupacional'.padEnd(33)+'S10844'.padEnd(9)+'Servei A'.padEnd(25)+'Torà'.padEnd(20)+'2';
 const text=[header,row].join('\n');
 const rows=extractColumnAnnexRows(text);
 assert.equal(rows.length,1);
 assert.equal(rows[0].quantity,2);
 assert.equal(rows[0].amountCents,null);
 assert.equal(rows[0].effectiveStart,undefined);
 assert.ok(text.replace(/\s+/g,' ').includes(rows[0].quote));
 assert.equal(extractColumnAnnexRows(row).length,0);
 assert.equal(extractColumnAnnexWithCoverage(text).complete,false);
 assert.equal(extractColumnAnnexWithCoverage(text+'\nTotal general 2').complete,true);
 assert.equal(extractColumnAnnexWithCoverage(text+'\nTotal general 3').complete,false);
 const invalid=row.replace('1.2.6.2.4.1','           ');
 assert.equal(extractColumnAnnexWithCoverage([header,row,invalid,'Total general 2'].join('\n')).complete,false);
});

test('a missing printed code retains its line as unresolved without renumbering known rows',()=>{
 const header='Nom entitat'.padEnd(25)+'NIF entitat'.padEnd(16)+'Codi cartera'.padEnd(15)+'Tipologia servei'.padEnd(33)+'Codi S'.padEnd(9)+'Nom servei'.padEnd(25)+'Municipi'.padEnd(20)+'assignar';
 const row=(nif:string,code:string,reses:string,quantity:number)=>'Fundació Prova'.padEnd(25)+nif.padEnd(16)+code.padEnd(15)+'Servei ocupacional'.padEnd(33)+reses.padEnd(9)+'Servei A'.padEnd(25)+'Torà'.padEnd(20)+quantity;
 const knownA=row('G12345678','1.2.6.2.4.1','S10844',2),knownB=row('G12345678','1.2.6.2.4.2','S03530',1);
 const missing=row('G12345678','','S00893',2);
 const baseline=extractColumnAnnexWithCoverage([header,knownA,knownB,'Total general 3'].join('\n'));
 const text=[header,knownA,missing,knownB,'Total general 5'].join('\n');
 const result=extractColumnAnnexWithCoverage(text);
 assert.equal(result.complete,false);assert.equal(result.unparsedRows,1);
 assert.deepEqual(result.rows.map(item=>[item.row,item.resesCode,item.observedServiceCode,item.quantity]),[
  [1,'S10844','1.2.6.2.4.1',2],[2,'S03530','1.2.6.2.4.2',1],[3,'S00893',null,2],
 ]);
 assert.deepEqual(result.rows.slice(0,2).map(item=>[item.row,item.resesCode]),baseline.rows.map(item=>[item.row,item.resesCode]));
 assert.ok(text.replace(/\s+/g,' ').includes(result.rows[2].quote));
 assert.equal(result.rows[2].amountCents,null);
});

test('a VAT-exempt column annex retains a wrapped code and cost from the same row',()=>{
 const header='Nom entitat'.padEnd(25)+'NIF entitat'.padEnd(16)+'cartera'.padEnd(15)+'Tipologia servei'.padEnd(30)+'Codi S'.padEnd(9)+'Nom servei'.padEnd(20)+'Municipi'.padEnd(18)+'IVA'.padEnd(7)+'assignar'+"       d'IVA)";
 const codeStart=header.indexOf('cartera'),quantityStart=header.indexOf('assignar');
 const wrapped=' '.repeat(codeStart)+'1.2.6.3.4.1'.padEnd(15)+' '.repeat(quantityStart-codeStart-15+7)+'29.432,04 €';
 const line='Fundació Prova'.padEnd(25)+'G12345678'.padEnd(16)+'.2'.padEnd(15)+'Servei ocupacional'.padEnd(30)+'S03832'.padEnd(9)+'Servei A'.padEnd(20)+'Selva'.padEnd(18)+'0%'.padEnd(7)+'3';
 const text=['2025 exempt d’IVA',header,wrapped,line,'Total general 3 29.432,04 €'].join('\n');
 const result=extractColumnAnnexWithCoverage(text);
 assert.equal(result.complete,true);
 assert.equal(result.rows[0].observedServiceCode,'1.2.6.3.4.1.2');
 assert.equal(result.rows[0].amountCents,2943204);
 assert.ok(text.replace(/\s+/g,' ').includes(result.rows[0].quote));
});

test('the labelled inclusive period cost after the places is extracted without using the daily tariff',()=>{
 const prefix='Nom entitat'.padEnd(25)+'NIF entitat'.padEnd(16)+'cartera'.padEnd(15)+'Tipologia servei'.padEnd(30)+'Codi S'.padEnd(9)+'Nom servei'.padEnd(20)+'Municipi'.padEnd(18)+'IVA'.padEnd(7)+'Preu diari'.padEnd(14)+'assignar';
 const header=prefix+'    (IVA inclòs si escau)';
 const costHeading=' '.repeat(header.indexOf('assignar')+8)+'Cost 15 de desembre - 31 de desembre de 2025';
 const line='Fundació Prova'.padEnd(25)+'G12345678'.padEnd(16)+'1.2.6.2.3.2.4'.padEnd(15)+'Servei de llar'.padEnd(30)+'S03668'.padEnd(9)+'Residència'.padEnd(20)+'Tiana'.padEnd(18)+'0%'.padEnd(7)+'96,48 €'.padEnd(14)+'1       1.640,16 €';
 const text=[costHeading,header,line,'Total general 1'].join('\n');
 const result=extractColumnAnnexWithCoverage(text);
 assert.equal(result.rows.length,1);assert.equal(result.complete,true);assert.equal(result.rows[0].amountCents,164016);
 assert.ok(text.replace(/\s+/g,' ').includes(result.rows[0].quote));
 assert.equal(extractColumnAnnexWithCoverage(text.replace(costHeading,'Preu diari')).rows[0].amountCents,null);
 assert.equal(extractColumnAnnexWithCoverage(text.replace('1       1.640,16 €','1')).rows[0].amountCents,null);
 assert.equal(extractColumnAnnexWithCoverage(text.replace('1       1.640,16 €','1       1.640,16 € 1.500,00 €')).rows[0].amountCents,null);
});

test('merged beneficiary cells are inherited only within the same printed disposition',()=>{
 const header=['Centre    Nom                     Codi        Tipologia',
  'gestor    entitat   NIF entitat   cartera     servei         Codi S   Nom servei   Partida pressupostària   GECAT     Disposició   Posició Municipi IVA mensual assignar 2024 sense IVA     2024 amb IVA'];
 const first='          Privada G12345678 1.2.3.6           gent gran      S00001 Servei A       D/251000200/315A/0000 N894         2600258588        5 Reus      0% 253,16 €         5     13.923,80 €     13.923,80 €';
 const next='                                  1.2.7.6     mental         S00002 Servei B       D/251000200/315A/0000 N894         2600258588        5 Reus      0% 253,16 €         5     13.923,80 €     13.923,80 €';
 const text=[...header,first,next,'Total general 10 27.847,60 €'].join('\n');
 const result=extractColumnAnnexWithCoverage(text);
 assert.equal(result.complete,true);
 assert.deepEqual(result.rows.map(row=>row.nif),['G12345678','G12345678']);
 assert.deepEqual(result.rows.map(row=>row.municipality),['Reus','Reus']);
 assert.ok(text.replace(/\s+/g,' ').includes(result.rows[1].quote));
 const changed=extractColumnAnnexWithCoverage(text.replace('2600258588        5 Reus      0% 253,16 €         5     13.923,80 €     13.923,80 €\nTotal','2600258589        5 Reus      0% 253,16 €         5     13.923,80 €     13.923,80 €\nTotal'));
 assert.equal(changed.complete,false);
 assert.equal(changed.unparsedRows,1);
});

test('program annex keeps the printed entity and service separate from repeated financial columns',()=>{
 const lines=[
  ' '.repeat(42)+"Entitat Exemple A"+' '.repeat(160)+"Centre residencial",
  ' '.repeat(42)+"Social \"PROVAX\""+' '.repeat(170)+"d’assistència als",
  ' '.repeat(27)+'A12345678'+' '.repeat(6)+'Social "PROVAX"'+' '.repeat(22)+'3711381860 2 567.355,58 € D/362111311/428E/1143 social 14311633 S12267 Fxxxxxxx Vxxxxxxxxxxx Cxxxxxxxxxxxxxx 7 284.792,75 €',
 ];
 const rows=extractProgram317Rows(lines.join('\n'));
 assert.equal(rows.length,1);
 assert.ok(rows[0].observedProviderName?.includes('PROVAX'));
 assert.equal('amountCents' in rows[0],false);
});

test('complete DSO/4390 official annex retains every monetary line and reconciles its VAT total',()=>{
 const rows=extractEconomicAnnexRows(readFileSync('tests/fixtures/official/dso-4390-2023-annex-7.txt','utf8'));
 assert.equal(rows.length,115);
 assert.equal(rows.reduce((sum,row)=>sum+row.amountCents,0),751151852);
 assert.ok(rows.every(row=>row.annex===7&&row.page>=32&&row.page<=47&&row.resesCode));
 assert.ok(rows.filter(row=>row.nif).every(row=>row.quote.includes(row.nif!)));
 const unresolved=rows.filter(row=>!row.nif);assert.equal(unresolved.length,1);
 assert.equal(unresolved[0].resesCode,'S04703');assert.equal(unresolved[0].page,41);
 assert.equal(unresolved[0].observedServiceCode,null);assert.equal(unresolved[0].observedProviderName,null);
 assert.equal(rows[0].observedProviderName,'Planiger, SA');
});

test('both official annex layouts cite a selected RESES line for every printed service code',()=>{
 for(const name of ['dso-4390-2023-annex-7','dsi-1984-2025-annex-6']){
  const text=readFileSync(`tests/fixtures/official/${name}.txt`,'utf8');
  const rows=extractEconomicAnnexRows(text);
  const codes=[...new Set(rows.map(row=>row.observedServiceCode))].filter((code):code is string=>!!code);
  const chunks=selectEvidenceWindow(splitText(text).map((content,ordinal)=>({content,ordinal,source_document_id:name})),24,false,true);
  const ordinals=annexCandidateOrdinals(rows.map(row=>({observed_service_code:row.observedServiceCode,reses_code:row.resesCode})),codes,chunks);
  assert.ok(ordinals.every(ordinal=>ordinal>0),`${name}: missing cited service`);
  assert.equal(codes.length,name.startsWith('dsi')?3:2);
 }
});
test('a wrapped service code is supported by a contiguous fragment of the correct document',()=>{
 const code='1.2.6.3.4.1.2';
 const rows=[{observed_service_code:code,reses_code:'S03832'}];
 const chunks=[{source_document_id:'other',content:'1.2.6.3.4.1 ... .2 S03832'},
  {source_document_id:'target',content:'1.2.6.3.4.1 descripció en una línia\n .2 auxiliar S03832'}];
 assert.deepEqual(annexCandidateOrdinals(rows,[code],chunks,'target'),[2]);
 assert.deepEqual(annexCandidateOrdinals(rows,[code],[{source_document_id:'target',content:'1.2.6.3.4.1 S03832'}],'target'),[0]);
 assert.deepEqual(annexCandidateOrdinals(rows,[code],[{source_document_id:'target',content:'1.2.6.3.4.1.2.9 S03832'}],'target'),[0]);
 const sourced=[{...rows[0],evidence_quote:'1.2.6.3.4.1 .2 servei S03832'}];
 assert.deepEqual(annexCandidateOrdinals(sourced,[code],[{source_document_id:'target',content:'1.2.6.3.4.1 .2 altre servei S03832'}],'target'),[0]);
 assert.deepEqual(annexCandidateOrdinals(sourced,[code],[{source_document_id:'target',content:'1.2.6.3.4.1 .2 servei S03832'}],'target'),[1]);
});
test('a code printed after RESES is attributed only within its own cited row',()=>{
 const quote='G12345678 S12345 D/251/318B/0000 1.2.1.15 110,00 euros';
 const rows=[{observed_service_code:'1.2.1.15',reses_code:'S12345',evidence_quote:quote}];
 assert.deepEqual(annexCandidateOrdinals(rows,['1.2.1.15'],[{source_document_id:'d',content:quote}],'d'),[1]);
 assert.deepEqual(annexCandidateOrdinals(rows,['1.2.1.15'],[{source_document_id:'other',content:quote}],'d'),[0]);
 const wrong='G12345678 S12345 S54321 D/251/318B/0000 1.2.1.15 110,00 euros';
 assert.deepEqual(annexCandidateOrdinals([{...rows[0],evidence_quote:wrong}],['1.2.1.15'],[{source_document_id:'d',content:wrong}],'d'),[0]);
 assert.deepEqual(annexCandidateOrdinals([{...rows[0],evidence_quote:null}],['1.2.1.15'],[{source_document_id:'d',content:quote}],'d'),[0]);
});
test('one known population never substitutes for another service with unknown population',()=>{
 const one={service_name:'Servei per a gent gran'};
 assert.deepEqual(concertPopulations([one,{service_name:'Servei per a persones amb discapacitat física'}]),['gent gran','persones amb discapacitat física']);
 assert.equal(concertPopulations([one,{service_name:'Servei sense població al nom'}]),null);
});

test('complete DSI/1984 official annex retains its 60 monetary lines and total',()=>{
 const rows=extractEconomicAnnexRows(readFileSync('tests/fixtures/official/dsi-1984-2025-annex-6.txt','utf8'));
 assert.equal(rows.length,60);
 assert.equal(rows.reduce((sum,row)=>sum+row.amountCents,0),38881748);
 assert.ok(rows.every(row=>row.annex===6&&row.page>=17&&row.page<=24&&row.nif&&row.resesCode));
 assert.deepEqual(new Set(rows.map(row=>row.observedServiceCode)),new Set(['1.2.6.2.4.1','1.2.6.2.4.2','1.2.6.2.1']));
});

test('a territorial provision and a program renewal retain overlapping case badges',()=>{
 assert.deepEqual(concertCaseKeys('Resolució de l’expedient 25-000163-AP (Barcelona) per a la provisió directa',[]),['award','territorial']);
 assert.deepEqual(concertCaseKeys('Resolució de pròrroga i autorització de la despesa del programa 317',[]),['renewal','program_renewal']);
});
test('an amendment of a termination and a service cession name the current act',()=>{
 assert.deepEqual(concertCaseKeys('Resolució d’esmena de la Resolució relativa al cessament voluntari',[]),['amendment']);
 assert.deepEqual(concertCaseKeys('RESOLUCIÓ per a la cessió del Servei de Pis assistit',[]),['cession']);
});
test('an amendment can reference vacant places without asserting their current status',()=>{
 const title='ESMENA DE LA RESOLUCIÓ DE PLACES DESERTES DE SERVEIS SOCIALS';
 assert.deepEqual(concertCaseKeys(title,[]),['amendment','vacant_reference']);
 assert.deepEqual(concertCaseKeys('ESMENA DE LA RESOLUCIÓ DE SERVEIS SOCIALS',[]),['amendment']);
 assert.deepEqual(concertCaseKeys('RESOLUCIÓ DE PLACES DESERTES',[]),['vacant']);
});
test('a definitive IFE award is not labelled as a call',()=>{
 const title='Resolució de la convocatòria IFE/1632/2025_ Provisió de Serveis SIE Hospitalet 2025-2029';
 assert.deepEqual(concertCaseKeys(title,[]),['unspecified','other_funder','multiyear']);
 assert.deepEqual(concertCaseKeys(title,[],'Resolc: 1. Assignar el servei a l’entitat INTRESS.'),['award','other_funder','multiyear']);
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
test('apostrophes in Terres de l’Ebre do not erase the territorial distinction',()=>{
 assert.equal(concertTerritory("Servei territorial de les Terres de l'Ebre"),'terres de l ebre');
 assert.equal(concertTerritory('Servei territorial de les Terres de l’Ebre'),'terres de l ebre');
 const rows:ConcertPublication[]=[
  {id:'base',title:"Provisió expedient 25-000123-AP (Terres de l’Ebre)",source_record_id:'base',source_payload:{data_publicacio:'2025-01-01'}},
  {id:'later',title:'Modificació expedient 25-000123-AP (Tarragona)',source_record_id:'later',source_payload:{data_publicacio:'2025-02-01'}},
 ];
 assert.deepEqual(proposeRecordLinks(rows),[]);
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

test('explicit resolution references survive a changed expediente and include other departments',()=>{
 for(const prefix of ['DSO','DSI','IFE','TSF']){
  const rows:ConcertPublication[]=[
   {id:'original',title:`Resolució ${prefix}/1234/2024 exp. 24-000123-AP (Barcelona)`,source_record_id:'old',source_payload:{data_publicacio:'2024-05-01'}},
   {id:'change',title:`Resolució de modificació de la Resolució ${prefix}/1234/2024 exp. 25-000999-AP (Barcelona)`,source_record_id:'new',source_payload:{data_publicacio:'2025-05-01'}},
  ];
  const links=proposeRecordLinks(rows);
  assert.equal(links.length,1);
  assert.equal(links[0].method,'explicit_resolution');
  assert.equal(links[0].earlierRecordId,'original');
  assert.equal(proposeRecordLinks([rows[0],{...rows[1],title:rows[1].title.replace('Barcelona','Lleida')}]).length,0);
 }
});

test('wrapped codes come from the printed column, never a built-in service family',()=>{
 const text=readFileSync('tests/fixtures/official/dsi-1984-2025-annex-6.txt','utf8');
 const moved=text.replaceAll('1.2.6.2.4.','1.2.8.3.7.');
 const rows=extractEconomicAnnexRows(moved);
 assert.equal(rows.length,60);
 assert.equal(rows.filter(row=>row.observedServiceCode?.startsWith('1.2.8.3.7.')).length,58);
 assert.equal(rows.filter(row=>row.observedServiceCode==='1.2.6.2.1').length,2);
 const missing=extractEconomicAnnexRows(text.replaceAll('1.2.6.2.4.','          '));
 assert.equal(missing.filter(row=>row.observedServiceCode===null).length,58);
 assert.equal(missing.filter(row=>row.observedServiceCode==='1.2.6.2.1').length,2);
});
test('mixed awards have the same operative interpretation in labels and processing',()=>{
 const title='Resolució de places denegades i assignades';
 const text='Resolc: 1. Denegar les peticions de l’annex 1. 2. Adjudicar les places de l’annex 2.';
 assert.equal(concertCaseKeys(title,[],text)[0],'award');
});

function mergedRow(nif:string,reses:string,disposition=''){
 const cells=[[27,nif],[42,nif?'Entitat Exemple':''],[78,disposition],[194,reses],[240,'Servei acreditat'],[280,'5'],[290,'1.234,56 €']] as const;
 let row='';for(const [column,value] of cells)row=row.padEnd(column)+value;return row;
}
const mergedHeader=' '.repeat(27)+'NIF entitat'.padEnd(15)+'Nom entitat'.padEnd(36)+'Disposició'.padEnd(116)+'Codi S'.padEnd(46)+'Tipologia de servei'.padEnd(40)+'Places';
test('merged identity cells retain each service and preserve previously assigned row identities',()=>{
 const first=mergedRow('G12345678','S00001','2600000001'),second=mergedRow('G87654321','S00003','2600000002');
 const raw=[mergedHeader,first,mergedRow('','S00002'),second,mergedRow('','S00004')].join('\n');
 const rows=extractProgram317Rows(raw);
 assert.deepEqual(rows.map(r=>[r.row,r.nif,r.resesCode]),[[1,'G12345678','S00001'],[2,'G87654321','S00003'],[3,'G12345678','S00002'],[4,'G87654321','S00004']]);
 assert.ok(rows[2].quote.includes('G12345678'));assert.ok(rows[2].quote.includes('S00002'));
 assert.ok(raw.replace(/\s+/g,' ').includes(rows[2].quote));
 assert.ok(rows.every(r=>!('amountCents' in r)));
});
test('merged identities are not inherited across pages, unknown layouts or different dispositions',()=>{
 const first=mergedRow('G12345678','S00001','2600000001');
 for(const text of [first+'\n'+mergedRow('','S00002'),mergedHeader+'\n'+first+'\f'+mergedHeader+'\n'+mergedRow('','S00002'),mergedHeader+'\n'+first+'\n'+mergedRow('','S00002','2600000099')])assert.equal(extractProgram317Rows(text).length,1);
});
test('an unreadable nonblank identity never inherits a previous entity',()=>{
 const text=[mergedHeader,mergedRow('G12345678','S00001','2600000001'),mergedRow('ILLEGIBLE','S00002'),mergedRow('','S00003')].join('\n');
 assert.equal(extractProgram317Rows(text).length,1);
});
