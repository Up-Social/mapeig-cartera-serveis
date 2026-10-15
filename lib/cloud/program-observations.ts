import {identifyPriorObservation} from '../concerts/observation-identity';
import {readPages} from '../read-pages';
import {createHash} from 'node:crypto';
import {extractProgramAnnex,programCoverage} from '../concerts/program-annex';
import {programServiceCode} from '../concerts/program-service';
import {loadOfficialCatalog} from '../official-catalog';
import {archiveUnitSource} from '../source-storage';
import {lease,type Context} from './context';
import {CloudFailure} from './errors';

export const PROGRAM_VERSION='program-columns-v2';
/** A bounded, resumable observation pass; reviewed values are never overwritten. */
export async function prepareProgramObservations(c:Context,job:{id:string;source_record_id:string},document:{id:string;storage_sha256:string;extracted_text:string},actType:string){
 const rows=extractProgramAnnex(document.extracted_text);
 if(!rows.length)return null;
 const catalog=await loadOfficialCatalog(c.db);
 const previous={data:await readPages((from,to)=>c.db.from('record_units').select('id,unit_key,provider_nif,reses_code,page,evidence_quote,document_id,storage_path,storage_sha256').eq('source_record_id',job.source_record_id).eq('document_id',document.id).neq('unit_key','legacy').order('id').range(from,to))};
 const versions={data:await readPages((from,to)=>c.db.from('concert_line_observations').select('unit_id,payload_hash').eq('source_record_id',job.source_record_id).eq('parser_version',PROGRAM_VERSION).order('id').range(from,to))};
 const claimed=new Set<string>();let staged=0;
 const occurrences=new Map<string,number>();
 const coverage=programCoverage(document.extracted_text,rows);
 const year=document.extracted_text.slice(0,2500).match(/per[ií]ode[\s\S]{0,100}?(20\d{2})/i)?.[1];
 const period=year&&/octubre a desembre/.test(document.extracted_text.slice(0,2500))?{effectiveStart:`${year}-10-01`,effectiveEnd:`${year}-12-31`,period:`${year}-10-01/${year}-12-31`}:{};
 for(const row of rows){
  const identity=`official-program:${document.storage_sha256}:${row.dispositionNumber}:${row.position}:${row.nif}:${row.resesCode}`;
  const occurrence=occurrences.get(identity)??0;occurrences.set(identity,occurrence+1);
  const unitKey=`${identity}:${occurrence}`;
  let existing:typeof previous.data[number]|undefined;
  try{existing=identifyPriorObservation(previous.data,claimed,row,unitKey);}catch{throw new CloudFailure('validation',5,{operation:'program_identity',code:'AMBIGUOUS_EXISTING_LINES'});}
  if(existing)claimed.add(existing.id);
  const line={...row,...period,unitKey:existing?.unit_key??unitKey,existingUnitId:existing?.id??null,
   observedServiceCode:programServiceCode(row.observedServiceName,catalog.all),actType,parserVersion:PROGRAM_VERSION};
  // Exclude assigned database IDs from the semantic revision hash.
  const payloadHash=createHash('sha256').update(JSON.stringify({...line,existingUnitId:null,unitKey:null})).digest('hex');
  if(versions.data.some(v=>v.payload_hash===payloadHash&&v.unit_id===existing?.id)){
   if(!existing?.storage_path||existing.storage_sha256!==document.storage_sha256){await archiveUnitSource(c.db,job.source_record_id,existing!.id);if(++staged>=5)return false;}
   continue;
  }
  const saved=await c.db.rpc('cloud_stage_program_observation',{...lease(c),p_job:job.id,p_document:document.id,p_line:line,p_hash:payloadHash});
  if(saved.error)throw new CloudFailure('validation',5,{operation:'program_observation',code:saved.error.code??'DATABASE_ERROR'});
  await archiveUnitSource(c.db,job.source_record_id,saved.data as string);
  if(++staged>=5)return false;
 }
 const declared=[...document.extracted_text.matchAll(/\bTotal\s+(?:general\s+)?([\d.]+,\d{2})\s*€/gi)].map(m=>Math.round(Number(m[1].replaceAll('.','').replace(',','.'))*100));
 const sum=rows.reduce((n,r)=>n+(r.amountCents??0),0);
 const checked=await c.db.rpc('cloud_finalize_program_observations',{...lease(c),p_job:job.id,p_document:document.id,
  p_rows:rows.length,p_sum_cents:sum,p_declared_cents:declared.includes(sum)?sum:null,p_coverage:coverage});
 if(checked.error)throw new CloudFailure('validation',5,{operation:'program_coverage',code:checked.error.code??'DATABASE_ERROR'});
 return true;
}
