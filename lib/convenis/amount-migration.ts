import type {SupabaseClient} from '@supabase/supabase-js';
import {retryDeduplicationTransaction} from '../pipeline/import-source-upsert';

export type ConveniAmountOperation={id:string;source_record_id:string;operation_id:string;source_hash:string;before_amount:number|null};

/** Repeats only a confirmed rolled-back conflict with the same manifest identity. */
export async function runConveniAmountTransaction(db:Pick<SupabaseClient,'rpc'>,entry:ConveniAmountOperation,revert:boolean,wait?:(ms:number)=>Promise<void>):Promise<void>{
 try{
  await retryDeduplicationTransaction(()=>revert
   ?db.rpc('revert_conveni_amount',{p_operation:entry.operation_id})
   :db.rpc('migrate_conveni_amount',{p_record:entry.id,p_operation:entry.operation_id,p_hash:entry.source_hash,p_before:entry.before_amount}),wait);
 }catch(error){
  const message=error instanceof Error?error.message:typeof error==='object'&&error!==null&&'message' in error?String(error.message):String(error);
  throw new Error(`${entry.source_record_id}: ${message}. Completed operations remain journaled; rerun the same manifest to resume.`,{cause:error});
 }
}
