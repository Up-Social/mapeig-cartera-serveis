import "server-only";
import { createServerSupabase } from "./records-page";
export type NavigationCounts = {records:number;batches:number;review:number;issues:number;results:number};
export async function getNavigationCounts():Promise<NavigationCounts>{
 const db=createServerSupabase();
 const [navigation,records,batches,outside]=await Promise.all([
  db.rpc('navigation_counts'),
  db.from('source_records').select('id',{count:'exact',head:true}),
  db.from('pipeline_runs').select('id',{count:'exact',head:true}).or('parameters->>purpose.is.null,parameters->>purpose.neq.record_operation'),
  db.from('current_record_results').select('id',{count:'exact',head:true}).eq('destination','outside'),
 ]);
 for(const result of [navigation,records,batches,outside])if(result.error)throw result.error;
 const counts=(navigation.data??{}) as {review?:number;issues?:number;approved?:number;discarded?:number};
 return {
  records:records.count??0,
  batches:batches.count??0,
  review:Number(counts.review??0),
  issues:Number(counts.issues??0),
  results:Number(counts.approved??0)+Number(counts.discarded??0)+(outside.count??0),
 };
}
