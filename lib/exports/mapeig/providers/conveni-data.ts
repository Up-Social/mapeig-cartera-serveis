import type {SupabaseClient} from '@supabase/supabase-js';
import {ConveniIndependentReadUnavailable,independentConveniReadersEnabled,requireConsistentConveniReads} from '@/lib/convenis/independent-read-guard';
import {readPages} from '@/lib/read-pages';
import type {ConveniCurrentUnitRow,ConveniMapeigData,ConveniProvisionRow,ConveniRecordRow} from './conveni-rows';

const CHUNK=100;
const chunks=<T,>(items:T[])=>Array.from({length:Math.ceil(items.length/CHUNK)},(_,i)=>items.slice(i*CHUNK,(i+1)*CHUNK));
type UnitRow=Omit<ConveniCurrentUnitRow,'payload'>&{instrument_grant:boolean|null};

/** Current Conveni units (latest job of each record, with its last review
 * event), their records and the approved Conveni provisions. Read-only. */
export async function loadConveniMapeigData(db:SupabaseClient):Promise<ConveniMapeigData>{
 await requireConsistentConveniReads(db);
 // The independent review ledger is experimental; its readers would see other rows.
 if(independentConveniReadersEnabled())throw new ConveniIndependentReadUnavailable();
 const rawUnits=await readPages(async(from,to)=>db.from('conveni_current_units').select('unit_id,job_id,source_record_id,data,instrument_grant:payload->instrument_grant,outcome,reviewed_code,reviewed_job,review_note').order('unit_id').range(from,to).returns<UnitRow[]>());
 const units:ConveniCurrentUnitRow[]=rawUnits.map(({instrument_grant,...unit})=>({...unit,payload:{instrument_grant}}));
 const provisions=await readPages(async(from,to)=>db.from('service_provisions').select('source_record_id,unit_id,provider_name,provider_nif,amount,service_code,award_date,contracting_body,target_population,period').eq('mechanism','Conveni').is('superseded_at',null).order('id').range(from,to).returns<ConveniProvisionRow[]>());
 const recordIds=[...new Set([...units.map(u=>u.source_record_id),...provisions.map(p=>p.source_record_id)])];
 const records:ConveniRecordRow[]=[];
 for(const ids of chunks(recordIds))records.push(...await readPages(async(from,to)=>db.from('source_records').select('id,source_record_id,title,source_payload').in('id',ids).eq('financing_type','conveni').order('id').range(from,to).returns<ConveniRecordRow[]>()));
 const conveni=new Set(records.map(r=>r.id));
 await requireConsistentConveniReads(db);
 return {units:units.filter(u=>conveni.has(u.source_record_id)),records,provisions:provisions.filter(p=>conveni.has(p.source_record_id))};
}
