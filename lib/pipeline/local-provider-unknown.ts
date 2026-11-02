import type {SupabaseClient} from '@supabase/supabase-js';
import {LocalTypeBlocked} from './local-matching-guard';

const diagnostic='Resultat del proveïdor desconegut. Cal revisar-lo abans de repetir.';
type ProviderScope={job_status:string;job_xmin:string;run_status:string;run_xmin:string};

/** Capture row revisions before invoking the child/provider, without writes. */
export async function captureLocalProviderScope(db:SupabaseClient,runId:string,jobId:string):Promise<ProviderScope>{
 try{
  const result=await db.rpc('local_provider_scope',{p_run:runId,p_job:jobId});
  const scope=result.data as Partial<ProviderScope>|null;
  if(result.error||!scope||typeof scope.job_status!=='string'||!/^\d+$/.test(scope.job_xmin??'')||typeof scope.run_status!=='string'||!/^\d+$/.test(scope.run_xmin??''))throw new LocalTypeBlocked();
  return scope as ProviderScope;
 }catch{throw new LocalTypeBlocked();}
}

/** Record only the affected task; never retry or rewrite source/evidence. */
export async function failLocalUnknownTask(db:SupabaseClient,taskId:string,owner?:string):Promise<void>{
 let query=db.from('worker_tasks').update({status:'failed',failure_kind:'provider_unknown',error_message:diagnostic,completed_at:new Date().toISOString()}).eq('id',taskId).eq('status','running');
 if(owner)query=query.eq('claimed_by',owner);
 const result=await query.select('id').maybeSingle();
 if(result.error||!result.data)throw new Error('PROVIDER_UNKNOWN: No s’ha pogut registrar el diagnòstic de la tasca.');
}

/** Pause the affected run and propagate a non-success outcome to its wrapper. */
export async function stopLocalRunForUnknown(db:SupabaseClient,runId:string,jobId:string,scope:ProviderScope):Promise<never>{
 let failed=false;
 try{const r=await db.rpc('local_pause_provider_unknown',{p_run:runId,p_job:jobId,p_scope:scope});if(r.error||r.data!==true)failed=true;}catch{failed=true;}
 throw new Error(failed?'PROVIDER_UNKNOWN: No s’ha pogut registrar completament la pausa; cal revisió.':`PROVIDER_UNKNOWN: ${diagnostic}`);
}
