import 'server-only';
import {createServerSupabase} from './records-page';
export type CurrentFilters={page:number;query?:string;type?:string;reason?:string;batch?:string;classification?:string;destination?:string};
export async function getCurrentResults(filters:CurrentFilters,limit=25){
 let request=createServerSupabase().from('current_record_results').select('*',{count:'exact'});
 if(filters.destination)request=request.eq('destination',filters.destination);
 if(filters.classification)request=request.eq('classification',filters.classification);
 if(filters.type&&filters.type!=='totes')request=request.eq('financing_type',filters.type);
 if(filters.reason)request=request.contains('reasons',[filters.reason]);
 if(filters.batch)request=request.eq('run_id',filters.batch);
 if(filters.query){const safe=filters.query.replaceAll(/[,%()]/g,' ').trim();request=request.or(`title.ilike.%${safe}%,source_record_id.ilike.%${safe}%,provider_name.ilike.%${safe}%`);}
 const {data,error,count}=await request.order('job_created_at',{ascending:false,nullsFirst:false}).order('id').range((filters.page-1)*limit,filters.page*limit-1);
 if(error)throw error;
 return {rows:data??[],total:count??0,pageCount:Math.max(1,Math.ceil((count??0)/limit))};
}
