import assert from 'node:assert/strict';
import {test} from 'node:test';
import {extractColumnAnnexWithCoverage} from '../lib/concerts/annex-extraction';
import {prepareConcertObservations} from '../lib/cloud/concerts';
import {CloudFailure} from '../lib/cloud/errors';

test('changed row coverage cannot reassign a reviewed ordinal, including before its archive copy exists',async()=>{
 const header='Nom entitat'.padEnd(25)+'NIF entitat'.padEnd(16)+'Codi cartera'.padEnd(15)+'Tipologia servei'.padEnd(33)+'Codi S'.padEnd(9)+'Nom servei'.padEnd(25)+'Municipi'.padEnd(20)+'assignar';
 const line=(reses:string)=>'Fundació Prova'.padEnd(25)+'G12345678'.padEnd(16)+'1.2.6.2.4.1'.padEnd(15)+'Servei ocupacional'.padEnd(33)+reses.padEnd(9)+'Servei A'.padEnd(25)+'Torà'.padEnd(20)+'1';
 const a=line('S10844'),b=line('S03530'),prefix='## Pàgina 1\n';
 const previous=extractColumnAnnexWithCoverage(prefix+[header,a,b,'Total general 2'].join('\n')).rows[0];
 const text=prefix+[header,a.replace('1.2.6.2.4.1',' '.repeat(11)),b,'Total general 2'].join('\n');
 assert.deepEqual(extractColumnAnnexWithCoverage(text).rows.map(row=>row.resesCode),['S03530','S10844']);
 for(const archive of [null,'archived']){
  const document={id:'doc',mime_type:'application/pdf',status:'fetched',extraction_partial:false,storage_sha256:'a'.repeat(64),extracted_text:text};
  const old={id:'unit',unit_key:`official-annex:${document.storage_sha256}:0:1`,document_id:'doc',storage_path:archive,storage_sha256:document.storage_sha256,
   observed_service_code:previous.observedServiceCode,provider_nif:previous.nif,observed_provider_name:previous.observedProviderName,
   reses_code:previous.resesCode,page:previous.page,evidence_quote:previous.quote,municipality:previous.municipality,
   quantity:previous.quantity,status:'approved',reviewed_at:'2026-01-01',amount:null,quantity_delta:null};
  const db={rpc(){throw Error('Unexpected write');},from(table:string){const q={select(){return q;},eq(){return q;},neq(){return q;},order(){return q;},
   range(){return Promise.resolve({data:table==='source_documents'?[document]:table==='record_units'?[old]:[],error:null});},
   single(){return Promise.resolve({data:{id:'record',title:'Resolució de provisió',source_record_id:'test',source_payload:{},financing_type:'concert'},error:null});},
   maybeSingle(){return Promise.resolve({data:null,error:null});},in(){return Promise.resolve({data:[],error:null});}};return q;}};
  await assert.rejects(prepareConcertObservations({db,task:'t',owner:'o',generation:1} as never,{id:'job',source_record_id:'record'}),
   (error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='CONCERT_SOURCE_ANCHOR_CHANGED');
 }
});
