import type {SupabaseClient} from '@supabase/supabase-js';
import {readPages} from './read-pages';
import {schemaSelect,type ExportProvision} from './runtime-schema';

const ID_BLOCK_SIZE=100;
const PROVISION_COLUMNS='id,source_id,unit_id,centre,period,act_type,annex_reference,call_url,regulatory_basis_url,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,master_services(service_name),official_services(service_name),source_records(financing_type)';
type Job={id:string;source_record_id:string};
type PendingUnit={id:string;source_record_id:string};

/** Offset pages have deterministic ordering but do not form a database snapshot. */
export async function readBatchExport(db:SupabaseClient,runId:string,withUnits:boolean){
 const jobs=await readPages<Job>((from,to)=>db.from('pipeline_jobs').select('id,source_record_id').eq('run_id',runId).order('id').range(from,to).returns<Job[]>());
 const recordIds=[...new Set(jobs.map(job=>job.source_record_id))].sort();
 const provisions=new Map<string,ExportProvision>();
 const pending=new Map<string,PendingUnit>();
 for(let offset=0;offset<recordIds.length;offset+=ID_BLOCK_SIZE){
  const ids=recordIds.slice(offset,offset+ID_BLOCK_SIZE);
  const page=await readPages<ExportProvision>((from,to)=>{
   let query=db.from('conveni_reviewed_provisions').select(schemaSelect(PROVISION_COLUMNS)).in('source_record_id',ids);
   if(withUnits)query=query.is('superseded_at',null);
   return query.order('id').range(from,to).returns<ExportProvision[]>();
  });
  for(const item of page)if(!provisions.has(item.id))provisions.set(item.id,item);
  if(withUnits){
   const units=await readPages<PendingUnit>((from,to)=>db.from('record_units').select('id,source_record_id').in('source_record_id',ids).neq('unit_key','legacy').eq('status','draft').order('id').range(from,to).returns<PendingUnit[]>());
   for(const item of units)if(!pending.has(item.id))pending.set(item.id,item);
  }
 }
 const pendingCounts=new Map<string,number>();
 for(const unit of pending.values())pendingCounts.set(unit.source_record_id,(pendingCounts.get(unit.source_record_id)??0)+1);
 return {recordIds,provisions:[...provisions.values()].sort((a,b)=>a.id.localeCompare(b.id)),pendingCounts};
}
