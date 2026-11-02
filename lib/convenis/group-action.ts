import type {SupabaseClient} from '@supabase/supabase-js';
import {readPages} from '../read-pages';
import {verifySelectedArchives} from './archive-verification';
import {groupPreparationRpcArgs,selectedGroupDocuments,type GroupPreparationRequest} from './group-preparation';

/** A later reviewed migration and deployment must explicitly enable this. */
export function isGroupPreparationEnabled():boolean{return false;}

/** No write is attempted until every selected archived object has been read
 * and hashed. The database then checks their versions and all review tokens. */
export async function performGroupPreparation(db:SupabaseClient,recordId:string,c:GroupPreparationRequest,signal?:AbortSignal,archiveFenceVerified=false):Promise<void>{
 if(!archiveFenceVerified)throw Error('La preparació està desactivada fins a verificar la coherència de versions de Storage');
 const [group,concepts]=await Promise.all([
  db.from('conveni_group_preparations').select('*').eq('source_record_id',recordId).eq('job_id',c.jobId).eq('unit_id',c.unitId).single(),
  readPages((from,to)=>db.from('conveni_concept_proposals').select('concept_index,review_id,review_is_current,outcome,reviewed_code,selected_citation').eq('source_record_id',recordId).eq('job_id',c.jobId).eq('unit_id',c.unitId).order('concept_index').range(from,to)),
 ]);
 if(group.error||!group.data||group.data.group_hash!==c.groupHash||group.data.analysis_hash!==c.analysisHash||group.data.source_hash!==c.sourceHash||group.data.parent_review_id!==c.parentReviewId||(group.data.preparation_id!==c.previousPreparationId&&group.data.preparation_id!==c.eventId))throw Error('Preparació o anàlisi obsoleta');
 const documents=selectedGroupDocuments(c,concepts);
 const snapshot=await db.rpc('conveni_archive_snapshot',{p_record:recordId,p_documents:documents});
 if(snapshot.error||!snapshot.data)throw Error('Falta una còpia arxivada amb versió verificable');
 const verified=await verifySelectedArchives(db,recordId,documents,snapshot.data,signal);
 const saved=await db.rpc('prepare_conveni_group_verified',groupPreparationRpcArgs(recordId,c,verified));
 if(saved.error)throw Error(saved.error.message);
}
