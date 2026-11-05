import type {SupabaseClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import {readPages} from '../read-pages';
import {isConveniScopeProposal} from './scope';

/** Pending Excel-row discard proposals, confirmed in bulk through the same
 * audited RPC as the individual confirmation. Every record is re-read and
 * re-checked before its decision; nothing is inferred from the request. */
export type ScopeProposalRow={id:string;jobId:string;sourceRecordId:string;title:string;provider:string|null;reason:string;rule:string;explanation:string};
export const BULK_SCOPE_LIMIT=200;

export async function listPendingScopeProposals(db:SupabaseClient):Promise<ScopeProposalRow[]>{
 const rows=await readPages<{id:string;job_id:string;title:string;source_record_id:string;provider_name:string|null}>((from,to)=>db.from('current_record_results')
  .select('id,job_id,title,source_record_id,provider_name').eq('financing_type','conveni').eq('destination','review').eq('classification','discarded')
  .order('source_record_id').order('id').range(from,to));
 const analyses:Array<{job_id:string;exclusion_reason:string|null;automatic:boolean;payload:{summary?:string;scope_rule?:string}}>=[];
 for(let i=0;i<rows.length;i+=100){
  const r=await db.from('conveni_analyses').select('job_id,exclusion_reason,automatic,payload').in('job_id',rows.slice(i,i+100).map(row=>row.job_id));
  if(r.error)throw Error(r.error.message);analyses.push(...(r.data??[]));
 }
 return rows.flatMap(row=>{
  const a=analyses.find(item=>item.job_id===row.job_id);
  if(!a||a.automatic||!a.exclusion_reason||!isConveniScopeProposal(a.payload?.scope_rule))return [];
  return [{id:row.id,jobId:row.job_id,sourceRecordId:row.source_record_id,title:row.title,provider:row.provider_name,reason:a.exclusion_reason,rule:String(a.payload.scope_rule),explanation:a.payload.summary??''}];
 });
}

export type BulkScopeResult={confirmed:string[];failed:Array<{id:string;error:string}>};
export async function confirmScopeProposals(db:SupabaseClient,ids:string[],note:string):Promise<BulkScopeResult>{
 const pending=new Map((await listPendingScopeProposals(db)).map(row=>[row.id,row]));
 const result:BulkScopeResult={confirmed:[],failed:[]};
 for(const id of ids){
  const row=pending.get(id);
  if(!row){result.failed.push({id,error:'Ja no és una proposta de descart pendent.'});continue;}
  const previous=await db.from('review_decisions').select('id').eq('source_record_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
  if(previous.error){result.failed.push({id,error:previous.error.message});continue;}
  const saved=await db.rpc('confirm_conveni_exclusion',{p_record:id,p_job:row.jobId,p_event:randomUUID(),p_previous:previous.data?.id??null,p_note:note});
  if(saved.error)result.failed.push({id,error:saved.error.message});else result.confirmed.push(id);
 }
 return result;
}
