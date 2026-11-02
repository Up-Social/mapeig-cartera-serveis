import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractAdministrativeCorrections} from '../lib/concerts/administrative-correction';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CaseAtAGlance} from '../components/case-at-a-glance';
import type {SourceRecord} from '../lib/workbench-types';

test('an administrative correction keeps each registry and its literal administrative fields',()=>{
 const text=['## Pàgina 2','RESOLC:','1. Esmenar les errades detectades en la resolució anterior:','## Pàgina 3','Expedient GECAT   Disposició   Posició','[...] S01277 Servei de prova','nom de l’entitat BE-2024-N956 2600258791 1 [...]','[...] S10598 Centre de dia','nom del servei BE-2024-N178 2600256561 1 [...]','2. Notificar la present resolució.'].join('\n');
 const result=extractAdministrativeCorrections(text);
 assert.equal(result.unparsedRows,0);assert.equal(result.rows.length,2);
 assert.deepEqual(result.rows.map(r=>[r.page,r.resesCode,r.gecat,r.disposition,r.position]),[[3,'S01277','BE-2024-N956','2600258791',1],[3,'S10598','BE-2024-N178','2600256561',1]]);
 assert.ok(result.rows.every(r=>text.replace(/\s+/g,' ').includes(r.quote)));
});
test('an award or an incomplete correction never creates administrative values',()=>{
 assert.deepEqual(extractAdministrativeCorrections('RESOLC: 1. Assignar places.\n2. Notificar.').rows,[]);
 const incomplete='RESOLC: 1. Esmenar.\n## Pàgina 3\nExpedient GECAT Disposició Posició\nS01277 Servei sense dades\n2. Notificar.';
 assert.equal(extractAdministrativeCorrections(incomplete).unparsedRows,1);
});
test('an incidental later reference to correcting does not turn an award into an amendment',()=>{
 const text='## Pàgina 3\nRESOLC: 1. Assignar serveis.\nExpedient GECAT Disposició Posició\nS01277 Servei BE-2024-N956 2600258791 1\n2. Notificar.\nEs pot esmenar una errada en un tràmit posterior.';
 const result=extractAdministrativeCorrections(text);
 assert.deepEqual(result,{rows:[],unparsedRows:0,incompleteBoundary:false});
});
test('a correction table on the same page as RESOLC retains the source page',()=>{
 const text='## Pàgina 4\nRESOLC: 1. Esmenar.\nExpedient GECAT Disposició Posició\nS01277 Servei BE-2024-N956 2600258791 1\n2. Notificar.';
 assert.equal(extractAdministrativeCorrections(text).rows[0]?.page,4);
});
test('an amendment without an identifiable end stays pending with an explanation',()=>{
 const text='## Pàgina 3\nRESOLC: 1. Esmenar.\nExpedient GECAT Disposició Posició\nS01277 Servei BE-2024-N956 2600258791 1';
 const result=extractAdministrativeCorrections(text);
 assert.equal(result.incompleteBoundary,true);
 assert.equal(result.rows.length,0);
 const record={financingType:'concert',title:'Esmena d’una resolució',mechanism:'Concert',providerName:null,amount:null,externalEnrichment:null,analysis:null,sourceDocuments:[{id:'doc',status:'fetched',mimeType:'application/pdf',extractedText:text,textLength:text.length,qualityFlags:[]}]} as unknown as SourceRecord;
 const html=renderToStaticMarkup(createElement(CaseAtAGlance,{record}));
 assert.match(html,/No s’ha pogut delimitar la secció de correccions/);
 assert.match(html,/no s’han proposat dades administratives/);
 assert.doesNotMatch(html,/GECAT BE-2024-N956/);
});
test('ambiguous administrative fields are not assigned to a registry row',()=>{
 const header='## Pàgina 3\nRESOLC: 1. Esmenar.\nExpedient GECAT Disposició Posició\n';
 for(const ambiguous of [
  'S01277 S10598 Servei BE-2024-N956 2600258791 1',
  'S01277 Servei BE-2024-N956 2600258791 1 BE-2024-N178 2600256561 1',
 ]){
  const result=extractAdministrativeCorrections(`${header}${ambiguous}\n2. Notificar.`);
  assert.equal(result.rows.length,0);
  assert.equal(result.unparsedRows,1);
 }
});
test('the case summary presents the proposed correction and its source without claiming an update',()=>{
 const text='## Pàgina 2\nRESOLC: 1. Esmenar.\n## Pàgina 3\nExpedient GECAT Disposició Posició\nS01277 Servei BE-2024-N956 2600258791 1\n2. Notificar.';
 const record={financingType:'concert',title:'Esmena d’una resolució',mechanism:'Concert',providerName:null,amount:null,externalEnrichment:null,analysis:null,sourceDocuments:[{id:'doc',status:'fetched',mimeType:'application/pdf',extractedText:text,textLength:text.length,qualityFlags:[]}]} as unknown as SourceRecord;
 const html=renderToStaticMarkup(createElement(CaseAtAGlance,{record}));
 assert.match(html,/S01277/);assert.match(html,/BE-2024-N956/);assert.match(html,/no modifica cap registre/);
 assert.match(html,/documents\/doc\/open#page=3/);
});
