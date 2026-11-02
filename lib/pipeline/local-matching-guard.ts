import type {SupabaseClient} from '@supabase/supabase-js';
import {readPages} from '../read-pages';

export const LOCAL_TYPE_BLOCKED = 'LOCAL_TYPE_BLOCKED';
const blockedMessage = `${LOCAL_TYPE_BLOCKED}: El lot conté concerts o tipologies no verificables. Reprograma'l amb el flux cloud compatible; no s'ha iniciat el processament local.`;
export class LocalTypeBlocked extends Error { constructor(message=blockedMessage){super(message);this.name='LocalTypeBlocked';} }
export function isLocalTypeBlocked(error:unknown):boolean {
 if(error instanceof LocalTypeBlocked)return true;
 if(error && typeof error==='object') {
  const e=error as {message?:unknown;stderr?:unknown};
  return [e.message,e.stderr].some(v=>typeof v==='string'&&v.includes(LOCAL_TYPE_BLOCKED));
 }
 return typeof error==='string'&&error.includes(LOCAL_TYPE_BLOCKED);
}

/** The local runner does not stage or reconcile the per-line Concert evidence. */
export function assertLocalMatchingType(type:unknown):void {
 if(!['conveni','contractacio','subvencio'].includes(String(type)))throw new LocalTypeBlocked();
}

/** Check before any claim or job/source update; a read failure also fails closed. */
export async function withLocalMatchingGuard<T>(db:SupabaseClient,recordId:string,run:()=>Promise<T>):Promise<T> {
 const result=await db.from('source_records').select('financing_type').eq('id',recordId).single();
 if(result.error)throw new LocalTypeBlocked();
 assertLocalMatchingType(result.data?.financing_type);
 return run();
}

/** Check the complete scope before a wrapper changes state or launches a child. */
export async function assertLocalRunTypes(db:SupabaseClient,runId:string,jobId?:string):Promise<void> {
 try {
  const state=await db.from('pipeline_runs').select('status').eq('id',runId).single();
  if(state.error||typeof state.data?.status!=='string')throw new LocalTypeBlocked();
  if(state.data.status==='paused')throw new LocalTypeBlocked(`${LOCAL_TYPE_BLOCKED}: El lot està pausat. Cal reprendre'l explícitament abans de processar-lo.`);
  const rows=await readPages((from,to)=>{
   let q=db.from('pipeline_jobs').select('id,source_records(financing_type)').eq('run_id',runId).order('id').range(from,to);
   if(jobId)q=q.eq('id',jobId);
   return q;
  });
  if(!rows.length)throw new LocalTypeBlocked();
  for(const row of rows){const source=Array.isArray(row.source_records)?row.source_records[0]:row.source_records;assertLocalMatchingType(source?.financing_type);}
 } catch(error){if(isLocalTypeBlocked(error))throw error;throw new LocalTypeBlocked();}
}

/** The enrichment command uses this exact job to run Conveni processing. */
export async function assertLocalEnrichmentScope(db:SupabaseClient,recordId:string,jobId?:string):Promise<{id:string;source_record_id:string;run_id:string}> {
 try {
  await withLocalMatchingGuard(db,recordId,async()=>{});
  let q=db.from('pipeline_jobs').select('id,source_record_id,run_id').eq('source_record_id',recordId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1);
  if(jobId)q=q.eq('id',jobId);
  const job=await q.single();
  if(job.error||!job.data?.id||!job.data.run_id||job.data.source_record_id!==recordId)throw new LocalTypeBlocked();
  const latest=await db.from('pipeline_jobs').select('id').eq('source_record_id',recordId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).single();
  if(latest.error||latest.data?.id!==job.data.id)throw new LocalTypeBlocked(`${LOCAL_TYPE_BLOCKED}: El treball d’enriquiment ja no és vigent.`);
  await assertLocalRunTypes(db,job.data.run_id);
  return job.data;
 } catch(error){if(isLocalTypeBlocked(error))throw error;throw new LocalTypeBlocked();}
}

/** Standalone matching may select jobs from several runs in a single invocation. */
export async function assertLocalSelectedRunTypes(db:SupabaseClient,jobs:readonly {run_id:string|null}[]):Promise<void> {
 for(const id of new Set(jobs.map(job=>job.run_id))){
  if(!id)throw new LocalTypeBlocked();
  await assertLocalRunTypes(db,id);
 }
}
