import 'server-only';
import {createServerSupabase} from './records-page';
import {CLASSIFICATIONS,type Classification} from './analysis-contract';
export async function classificationReport(classification:string,page=1,limit=50){
 const filter=CLASSIFICATIONS.includes(classification as Classification)?classification:'out_of_portfolio';
 const db=createServerSupabase();
 const result=await db.from('current_analysis_results').select('*,source_records(source_record_id,title,amount,source_dataset,source_documents(url),record_enrichments(amount))',{count:'exact'}).eq('reviewed_classification',filter).order('reviewed_at',{ascending:false}).range((page-1)*limit,page*limit-1);
 if(result.error)throw result.error;
 return {rows:result.data??[],total:result.count??0};
}
