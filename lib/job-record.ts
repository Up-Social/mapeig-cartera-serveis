import 'server-only';
import {createServerSupabase,mapRecord,RECORD_SELECT} from './records-page';
import type {SourceRecord} from './workbench-types';
export async function getJobRecord(jobId:string):Promise<SourceRecord|null>{
 const db=createServerSupabase();const job=await db.from('pipeline_jobs').select('id,source_record_id').eq('id',jobId).maybeSingle();if(job.error)throw job.error;if(!job.data)return null;
 const result=await db.from('source_records').select(RECORD_SELECT).eq('id',job.data.source_record_id).single();if(result.error)throw result.error;
 const raw=result.data as Record<string,unknown>;const current=mapRecord(raw);const jobs=raw.pipeline_jobs as Record<string,unknown>[];const selected=jobs.find(j=>j.id===jobId);if(!selected)return null;
 if(current.currentJobId===jobId)return current;
 const snapshot=await db.from('job_snapshots').select('payload,kind,job_document_versions(document_versions(payload))').eq('pipeline_job_id',jobId).order('captured_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();if(snapshot.error)throw snapshot.error;
 const payload=snapshot.data?.payload as Record<string,unknown>|undefined;
 const source=payload?.source as Record<string,unknown>|undefined;
 const documents=(snapshot.data?.job_document_versions??[]).flatMap(v=>{const versions=Array.isArray(v.document_versions)?v.document_versions:[v.document_versions];return versions.filter(Boolean).map(item=>item.payload.document);});
 // Never fill missing historical input with the mutable current source row.
 const record=mapRecord({...source,id:job.data.source_record_id,source_record_id:source?.source_record_id??'No recuperable',source_dataset:source?.source_dataset??'No recuperable',mechanism:source?.mechanism??'No recuperable',title:source?.title??'Dades originals històriques no recuperables',review_decisions:raw.review_decisions,pipeline_jobs:[selected],source_documents:documents,record_enrichments:payload?.enrichment??null});
 return {...record,isHistorical:true,historicalDataUnavailable:!source};
}
