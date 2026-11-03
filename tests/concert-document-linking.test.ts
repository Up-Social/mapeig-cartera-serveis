import test from 'node:test';
import assert from 'node:assert/strict';
import {concertSignatureDates,proposeDocumentRecordLinks,type ConcertLinkDocument} from '../lib/concerts/document-linking';
import type {ConcertPublication} from '../lib/concerts/record-linking';
const title='Resolució de pròrroga i autorització de la despesa derivada de la provisió dels serveis de concert social i gestió delegada del programa 315 de la Xarxa de Serveis Socials d’Atenció Pública del Servei Territorial de Girona';
const earlier:ConcertPublication={id:'original',title,source_record_id:'etauler:original',source_payload:{data_publicacio:'2024-09-09'}};
const later:ConcertPublication={id:'correction',title:`Resolució de rectificació d’errors de la ${title}`,source_record_id:'etauler:correction',source_payload:{data_publicacio:'2024-12-30'}};
const paragraph=`En data 5 de setembre de 2024, la Consellera va signar la ${title}.\n\n2. Notificar aquesta resolució.`;
const doc=(id:string,text:string):ConcertLinkDocument=>({id:`doc-${id}`,source_record_id:id,status:'fetched',mime_type:'application/pdf',extraction_partial:false,extraction_method:'pdf-text',quality_flags:[],storage_path:`cases/${id}/source.pdf`,storage_sha256:'a'.repeat(64),extracted_text:text});
const docs=[doc('original',`${title}\nText administratiu acreditat sobre la pròrroga dels serveis i els imports detallats a l’annex.\nDoc.original signat per: Document electrònic\nConsellera X web csv.gencat.cat fins al 09/09/2027\n05/09/2024\nData creació còpia: 09/09/2024`),doc('correction',`${later.title}\nFets\n${paragraph}\nFonaments de dret\nLlei 39/2015.`)];
test('signature dates exclude copy and verification dates',()=>{
 assert.deepEqual(concertSignatureDates(docs[0].extracted_text!),['2024-09-05']);
 assert.deepEqual(concertSignatureDates('Data creació còpia: 05/09/2024'),[]);
 assert.deepEqual(concertSignatureDates('Doc.original signat per:\n31/02/2024'),[]);
});
test('archived reference matches signature date instead of publication date',()=>{
 const links=proposeDocumentRecordLinks([earlier,later],docs);assert.equal(links.length,1);assert.equal(links[0].earlierRecordId,'original');assert.equal(links[0].method,'explicit_resolution');assert.match(links[0].evidence,/2024-09-05/);assert.match(links[0].evidence,/no confirma imports/);
});
test('no date-only, cross-territory, cross-programme or future predecessor matches',()=>{
 for(const change of [{title:title.replace('Girona','Lleida')},{title:title.replace('315','317')},{title:'Resolució del servei de suport per a persones grans dependents de Barcelona'},{source_payload:{data_publicacio:'2025-01-01'}}])assert.equal(proposeDocumentRecordLinks([{...earlier,...change},later],docs).length,0);
});
test('missing, partial or unarchived documents cannot supply a dated predecessor',()=>{
 for(const change of [{status:'error'},{extraction_partial:true},{storage_sha256:null},{storage_path:null},{quality_flags:['corrupt_text']},{extracted_text:null}]){
  assert.equal(proposeDocumentRecordLinks([earlier,later],[{...docs[0],...change},docs[1]]).length,0);
  assert.equal(proposeDocumentRecordLinks([earlier,later],[docs[0],{...docs[1],...change}]).length,0);
 }
});
test('date errors are not silently corrected and legal foundations do not identify originals',()=>{
 const corrected=docs[1].extracted_text!;
 assert.equal(proposeDocumentRecordLinks([earlier,later],[docs[0],{...docs[1],extracted_text:corrected.replace('5 de setembre de 2024','5 de setembre de 2023')}]).length,0);
 assert.equal(proposeDocumentRecordLinks([earlier,later],[docs[0],doc('correction',`${later.title}\nFonaments de dret\n${paragraph}`)]).length,0);
});
test('several matching archived originals remain alternatives and repeated documents do not duplicate links',()=>{
 const second={...earlier,id:'second'};
 const links=proposeDocumentRecordLinks([earlier,second,later],[...docs,docs[1],{...docs[0],id:'doc-second',source_record_id:'second'}]);
 assert.deepEqual(links.map(l=>l.earlierRecordId).sort(),['original','second']);
});
test('a cited pre-2024 original is not recovered into the current horizon',()=>{
 const oldDocs=docs.map(d=>({...d,extracted_text:d.extracted_text!.replaceAll('05/09/2024','05/09/2023').replaceAll('5 de setembre de 2024','5 de setembre de 2023')}));
 assert.equal(proposeDocumentRecordLinks([earlier,later],oldDocs).length,0);
});
test('explicit numbered amendments require the matching object, not a shared call',()=>{
 const original={...earlier,title:`Resolució DSI/123/2024 ${title}`};
 const amendment={...later,title:`Esmena de la ${original.title}`};
 const text=`${amendment.title}\nFets\nRectificar la Resolució DSI/123/2024 en els termes detallats a l’annex.\nFonaments de dret\nLlei 39/2015.`;
 const numbered=[docs[0],doc('correction',text)];
 assert.equal(proposeDocumentRecordLinks([original,amendment],numbered).length,1);
 assert.equal(proposeDocumentRecordLinks([{...original,title:`${original.title} de convocatòria`},amendment],numbered).length,0);
 assert.equal(proposeDocumentRecordLinks([{...original,title:original.title.replace('123/2024','123/2023')},{...amendment,title:amendment.title.replace('123/2024','123/2023')}],[docs[0],doc('correction',text.replaceAll('123/2024','123/2023'))]).length,0);
});

test('PDF territory overrides a generic imported title when excluding a false predecessor',()=>{
 const generic=title.replace(' del Servei Territorial de Girona','');
 const pubs=[{...earlier,title:generic},{...later,title:`Rectificació de la ${generic}`}];
 const barcelona={...docs[0],extracted_text:docs[0].extracted_text!.replaceAll('Girona','Barcelona')};
 assert.equal(proposeDocumentRecordLinks(pubs,[barcelona,docs[1]]).length,0);
});

test('an explicit call is a procedural candidate for an award, never a financial original',()=>{
 const call={...earlier,id:'call',title:'Resolució DSI/3383/2025, de convocatòria per a la provisió de places',source_payload:{data_publicacio:'2025-09-22'}};
 const award={...later,id:'award',title:'RESOLUCIÓ de provisió de serveis socials PIL',source_payload:{data_publicacio:'2025-11-01'}};
 const extra=' El document recull les condicions, les persones destinatàries i el procediment aplicable.'.repeat(5);
 const callDoc=doc('call','Resolució DSI/3383/2025, de 15 de setembre, de convocatòria per a la provisió de places.'+extra);
 const awardDoc=doc('award','Fets\nEn data 22 de setembre es va publicar la Resolució DSI/3383/2025, de 15 de setembre, de convocatòria per a la provisió de places.\nFonaments de dret\nNormes.\nRESOLC: 1. Assignar 4 places al servei documentat.'+extra);
 const links=proposeDocumentRecordLinks([call,award],[callDoc,awardDoc]);
 assert.equal(links.length,1);assert.equal(links[0].kind,'call');assert.equal(links[0].earlierRecordId,'call');
 assert.match(links[0].evidence,/candidata documental|Candidata documental/);assert.match(links[0].evidence,/no acredita imports/);
 for(const bad of [
  {...awardDoc,extracted_text:awardDoc.extracted_text!.replaceAll('3383/2025','3384/2025')},
  {...awardDoc,extracted_text:awardDoc.extracted_text!.replace('Assignar','Proposar')},
  {...awardDoc,extracted_text:awardDoc.extracted_text!.replace('Fets\nEn data','Fonaments de dret\nEn data')},
  {...awardDoc,extraction_partial:true},
  {...awardDoc,extraction_partial:null},
  {...awardDoc,extraction_coverage:{complete:false}},
  {...awardDoc,extraction_method:null},
 ])assert.deepEqual(proposeDocumentRecordLinks([call,award],[callDoc,bad]),[]);
 assert.deepEqual(proposeDocumentRecordLinks([call,award],[{...callDoc,extracted_text:callDoc.extracted_text!.replace('3383/2025','3384/2025')},awardDoc]),[]);
 assert.deepEqual(proposeDocumentRecordLinks([call,award],[{...callDoc,extraction_partial:null},awardDoc]),[]);
 assert.deepEqual(proposeDocumentRecordLinks([call,award],[{...callDoc,extraction_coverage:{complete:false}},awardDoc]),[]);
 assert.deepEqual(proposeDocumentRecordLinks([{...call,source_payload:{data_publicacio:'2025-12-01'}},award],[callDoc,awardDoc]),[]);
 assert.deepEqual(proposeDocumentRecordLinks([call,{...award,title:'Esmena de la resolució de provisió'}],[callDoc,awardDoc]),[]);
});

test('an unarchived call is linked only when its official title starts with the literal citation',()=>{
 const call={...earlier,id:'call',title:'Resolució DSI/2075/2025, de 4 de juny, de convocatòria per a la provisió de places en serveis',source_payload:{data_publicacio:'2025-06-12'}};
 const award={...later,id:'award',title:'RESOLUCIÓ de provisió de serveis socials PIL',source_payload:{data_publicacio:'2025-08-12'}};
 const extra=' El document recull les condicions, les persones destinatàries i el procediment aplicable.'.repeat(5);
 const awardDoc=doc('award','Fets\n1. En data 11 de juny de 2025 es va publicar la Resolució DSI/2075/2025, de 4 de juny, de\nconvocatòria per a la provisió de places.\nFonaments de dret\nNormes.\nRESOLC: 1. Assignar 5 places al servei documentat.'+extra);
 const links=proposeDocumentRecordLinks([call,award],[awardDoc]);
 assert.equal(links.length,1);assert.equal(links[0].kind,'call');assert.match(links[0].evidence,/encara no està arxivat/);
 assert.deepEqual(proposeDocumentRecordLinks([{...call,title:'Resolució DSI/2075/2025, de 5 de juny, de convocatòria'},award],[awardDoc]),[]);
 const otherCallDoc=doc('call','Resolució DSI/9999/2025, de convocatòria.'+extra);
 assert.deepEqual(proposeDocumentRecordLinks([call,award],[otherCallDoc,awardDoc]),[]);
});
