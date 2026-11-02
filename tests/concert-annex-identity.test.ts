import test from 'node:test';
import assert from 'node:assert/strict';
import {reconciledConcertAnalysis} from '../lib/cloud/concert-analysis';

test('a financially reconciled annex cannot claim an identity absent from its own line evidence',async()=>{
 const report={document_id:'doc',document_sha256:'hash',annex:6,row_count:1,sum_cents:10000,declared_cents:10000,reconciled:true,coverage:{}};
 const line={observed_service_code:'1.2.3',provider_nif:null,reses_code:'S12345',evidence_quote:'S12345 · Servei de suport · 100,00 €',act_type:'award',amount:100,storage_path:'stored',storage_sha256:'hash'};
 const db={from(table:string){const data=table==='record_units'?[line]:[report];const q={select(){return q;},eq(){return q;},like(){return q;},then(resolve:(value:unknown)=>unknown){return Promise.resolve({data,error:null}).then(resolve);}};return q;}};
 const context={db} as never;const job={id:'job',source_record_id:'record'};const chunks=[{source_document_id:'doc',content:line.evidence_quote}];
 const missing=await reconciledConcertAnalysis(context,job,[],chunks);assert.equal(missing?.classification,'insufficient_evidence');assert.deepEqual(missing?.candidates,[]);
 line.provider_nif='G12345678' as never; // A NIF inferred from another row is still not cited here.
 const inherited=await reconciledConcertAnalysis(context,job,[],chunks);assert.equal(inherited?.classification,'insufficient_evidence');
});
