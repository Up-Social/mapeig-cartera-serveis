import "server-only";
import {classifyIssue,type IssueFilters,type IssuePage} from './issue-types';
import {createServerSupabase,mapRecord,RECORD_SELECT} from './records-page';
export async function getIssuePage(filters:IssueFilters):Promise<IssuePage>{
 const db=createServerSupabase();
 let request=db.from('current_issue_results').select('*',{count:'exact'});
 if(filters.type&&filters.type!=='totes')request=request.eq('financing_type',filters.type);
 if(filters.query){const safe=filters.query.replaceAll(/[,%()]/g,' ').trim();request=request.or(`title.ilike.%${safe}%,source_record_id.ilike.%${safe}%,provider_name.ilike.%${safe}%`);}
 const from=(filters.page-1)*25;
 const page=await request.order('job_created_at',{ascending:false,nullsFirst:false}).order('id').range(from,from+24);
 if(page.error)throw page.error;
 const result={rows:page.data??[],total:page.count??0,pageCount:Math.max(1,Math.ceil((page.count??0)/25))};
 const ids=result.rows.map(r=>r.id);
 const records=ids.length?await db.from('source_records').select(RECORD_SELECT).in('id',ids):{data:[],error:null};
 if(records.error)throw records.error;
 const projected = new Map(result.rows.map(row=>[row.id,row]));
 const issues=(records.data??[]).map(mapRecord).map(record=>{
   const row=projected.get(record.id);
   record.issueGroup=(row?.issue_group as typeof record.issueGroup)??null;
   if(row?.worker_incident){
     const at=String(row.worker_last_activity_at??row.job_created_at);
     record.operationProgress={state:'incident',step:row.worker_step??null,completed:null,total:null,detail:null,startedAt:String(row.job_created_at),lastActivityAt:at,finishedAt:at,attempts:0,failureKind:row.worker_failure_kind??null};
   }
   return classifyIssue(record);
 }).filter((i):i is NonNullable<typeof i>=>i!==null);
 const count=async(group?:string)=>{let q=db.from('current_issue_results').select('id',{head:true,count:'exact'});if(group)q=q.eq('issue_group',group);const r=await q;if(r.error)throw r.error;return r.count??0;};
 const [total,insufficient,technical,source]=await Promise.all([count(),count('insufficient'),count('technical'),count('source')]);
 return {issues,total:result.total,page:filters.page,pageCount:result.pageCount,pageSize:25,metrics:{total,rejected:0,insufficient,technical,source}};
}
