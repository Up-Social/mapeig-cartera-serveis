import {extractConcertChangeGeography} from '../concerts/geography';
import type {ConcertChangeLine} from '../concerts/change-extraction';
import {lease,type Context} from './context';
import {CloudFailure} from './errors';
import {createHash} from 'node:crypto';

/** Supplemental facts never mutate the financial line or its review fingerprint. */
export async function storeConcertChangeGeography(c:Context,jobId:string,unitId:string,document:{extracted_text:string|null;storage_sha256:string|null},row:ConcertChangeLine){
 if(!document.extracted_text||!document.storage_sha256)return;
 const geography=extractConcertChangeGeography(document.extracted_text,row);
 if(!geography)return;
 const saved=await c.db.rpc('cloud_store_concert_geography',{...lease(c),p_job:jobId,p_unit:unitId,p_geography:{...geography,
  document_sha256:document.storage_sha256,extracted_text_hash:createHash('sha256').update(document.extracted_text).digest('hex')}});
 if(saved.error)throw new CloudFailure('validation',5,{operation:'concert_geography',code:'CONCERT_GEOGRAPHY_SAVE_FAILED',message:'No s’han pogut desar el municipi, la comarca i la província amb la seva font. Les dades econòmiques es conserven; cal revisar aquesta incidència.'});
}
