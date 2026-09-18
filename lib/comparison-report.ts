import 'server-only';
import {createServerSupabase} from './records-page';
import {compareSnapshots} from './batch-comparison';
export async function getComparisonReport(id:string){
 const db=createServerSupabase();const run=await db.from('pipeline_runs').select('id,batch_number,comparison_of,status').eq('id',id).single();if(run.error||!run.data.comparison_of)return null;
 const members:Array<{source_record_id:string;origin_job_id:string;baseline:unknown}>=[];
 for(let offset=0;;offset+=500){const r=await db.from('comparison_members').select('source_record_id,origin_job_id,baseline').eq('run_id',id).order('source_record_id').range(offset,offset+499);if(r.error)throw r.error;members.push(...r.data);if(r.data.length<500)break;}
 const records=[];
 for(const member of members){
  const job=await db.from('pipeline_jobs').select('id').eq('run_id',id).eq('source_record_id',member.source_record_id).single();if(job.error)throw job.error;
  const [snapshot,phases,review]=await Promise.all([db.from('job_snapshots').select('id,payload').eq('pipeline_job_id',job.data.id).order('captured_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle(),db.from('job_phase_states').select('*').eq('id',job.data.id).single(),db.from('review_decisions').select('*').eq('pipeline_job_id',job.data.id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()]);
  for(const r of [snapshot,phases,review])if(r.error)throw r.error;
  const versions=snapshot.data?await db.from('job_document_versions').select('document_versions(payload)').eq('snapshot_id',snapshot.data.id):{data:[],error:null};if(versions.error)throw versions.error;
  const documents=(versions.data??[]).flatMap(v=>Array.isArray(v.document_versions)?v.document_versions.map(d=>d.payload):[(v.document_versions as {payload:unknown}).payload]);
  records.push({recordId:member.source_record_id,jobId:job.data.id,originJobId:member.origin_job_id,...compareSnapshots(member.baseline,{...snapshot.data?.payload,phases:phases.data,review:review.data,documents})});
 }
 return {run:run.data,total:records.length,classificationChanges:records.filter(r=>r.classificationChanged).length,codeChanges:records.filter(r=>r.codesChanged).length,pendingHumanReview:records.filter(r=>r.humanReviewPending).length,records};
}
