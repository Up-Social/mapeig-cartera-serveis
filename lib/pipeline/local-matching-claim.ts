import type {SupabaseClient} from '@supabase/supabase-js';
import {LocalTypeBlocked,LOCAL_TYPE_BLOCKED,isLocalTypeBlocked} from './local-matching-guard';

export async function claimLocalMatchingJob(db:SupabaseClient,jobId:string,recordId:string):Promise<boolean>{
 const result=await db.rpc('local_claim_matching_job',{p_job:jobId,p_record:recordId});
 if(result.error){if(isLocalTypeBlocked(result.error))throw new LocalTypeBlocked();throw new Error('No s’ha pogut adquirir el treball local de matching.');}
 if(typeof result.data!=='boolean')throw new LocalTypeBlocked();
 return result.data;
}
export async function reportLocalMatchingFailure(db:SupabaseClient,jobId:string,recordId:string,kind:string,message:string):Promise<void>{
 const result=await db.rpc('local_report_matching_failure',{p_job:jobId,p_record:recordId,p_kind:kind,p_message:message});
 if(result.error)throw new Error('No s’ha pogut registrar el resultat del treball local.');
 if(result.data!==true)throw new LocalTypeBlocked(`${LOCAL_TYPE_BLOCKED}: El treball de matching ja no és vigent o el registre està en modificació.`);
}
