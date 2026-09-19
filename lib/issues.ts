import "server-only";
import {classifyIssue,type IssueFilters,type IssuePage} from './issue-types';
import {getCurrentResults} from './current-results';
import {createServerSupabase,mapRecord,RECORD_SELECT} from './records-page';
export async function getIssuePage(filters:IssueFilters):Promise<IssuePage>{
 const db=createServerSupabase();
 const result=await getCurrentResults({...filters,destination:'issues'});
 const ids=result.rows.map(r=>r.id);
 const records=ids.length?await db.from('source_records').select(RECORD_SELECT).in('id',ids):{data:[],error:null};
 if(records.error)throw records.error;
 const issues=(records.data??[]).map(mapRecord).map(classifyIssue).filter((i):i is NonNullable<typeof i>=>i!==null);
 const count=async(group?:string)=>{let q=db.from('current_issue_results').select('id',{head:true,count:'exact'});if(group)q=q.eq('issue_group',group);const r=await q;if(r.error)throw r.error;return r.count??0;};
 const [total,insufficient,technical,source]=await Promise.all([count(),count('insufficient'),count('technical'),count('source')]);
 return {issues,total:result.total,page:filters.page,pageCount:result.pageCount,pageSize:25,metrics:{total,rejected:0,insufficient,technical,source}};
}
