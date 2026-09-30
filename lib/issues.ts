import "server-only";
import {classifyIssue,type IssueFilters,type IssuePage} from './issue-types';
import {getCurrentResults} from './current-results';
import {createServerSupabase,mapRecord} from './records-page';

// Lists only need enough documentary metadata to classify an incident. Full
// extracted text and cited chunks remain available on the record detail.
export const ISSUE_RECORD_SELECT = "id,source_dataset,financing_type,source_record_id,mechanism,title,provider_name,amount,processing_status,cartera_code,cartera_name,confidence,evidence,evidence_status,evidence_error,enrichment_status,enrichment_error,updated_at,source_documents(id,url,resolution,document_type,source_fields,status,mime_type,text_preview,text_length,extraction_method,quality_score,quality_flags,chunk_count),review_decisions(id,pipeline_job_id,classification,reasons,decision,reason,created_at),pipeline_jobs(id,run_id,status,error_message,created_at,analysis_results(id,classification,reasons,explanation,service_description,target_population,catalog_version_id,rules_version,reviewed_classification,review_notes,reviewed_reasons,reliability_status,reliability_reasons,invalidated_at,reviewed_at),pipeline_runs(batch_number),matching_candidates(id,pipeline_job_id,catalog_version_id,rank,target_code,target_name,score,rationale,engine_version))";

export async function getIssuePage(filters:IssueFilters):Promise<IssuePage>{
 const db=createServerSupabase();
 const [result,groups]=await Promise.all([
  getCurrentResults({...filters,destination:'issues'}),
  getIssueGroups(db),
 ]);
 const ids=result.rows.map(r=>r.id);
 const records=ids.length?await db.from('source_records').select(ISSUE_RECORD_SELECT).in('id',ids):{data:[],error:null};
 if(records.error)throw records.error;
 const projected = new Map(result.rows.map(row=>[row.id,row]));
 const mapped=new Map((records.data??[]).map(mapRecord).map(record=>[record.id,record]));
 const issues=result.rows.flatMap(row=>{
   const record=mapped.get(row.id);if(!record)return [];
   const projectedRow=projected.get(record.id);
   if(projectedRow?.worker_incident){
     const at=String(projectedRow.worker_last_activity_at??projectedRow.job_created_at);
     record.operationProgress={state:'incident',step:projectedRow.worker_step??null,completed:null,total:null,detail:null,startedAt:String(projectedRow.job_created_at),lastActivityAt:at,finishedAt:at,attempts:0,failureKind:projectedRow.worker_failure_kind??null};
   }
   const issue=classifyIssue(record);return issue?[issue]:[];
 });
 const metricRows=groups;
 const total=metricRows.length;
 const insufficient=metricRows.filter(row=>row.issue_group==='insufficient').length;
 const technical=metricRows.filter(row=>row.issue_group==='technical').length;
 const source=metricRows.filter(row=>row.issue_group==='source').length;
 return {issues,total:result.total,page:filters.page,pageCount:result.pageCount,pageSize:25,metrics:{total,rejected:0,insufficient,technical,source}};
}

async function getIssueGroups(db:ReturnType<typeof createServerSupabase>){
 const rows:Array<{issue_group:string|null}>=[];
 for(let offset=0;;offset+=1000){
  const result=await db.from('current_issue_results').select('issue_group').range(offset,offset+999);
  if(result.error)throw result.error;rows.push(...result.data);
  if(result.data.length<1000)return rows;
 }
}
