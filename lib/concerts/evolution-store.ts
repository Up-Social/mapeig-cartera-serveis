import type {SupabaseClient} from '@supabase/supabase-js';
import type {ConcertEvolutionData,EconomicUnit,EconomicReview,EconomicLink,EconomicPublication} from './evolution';

export async function loadConcertEvolution(db:SupabaseClient,recordId?:string):Promise<ConcertEvolutionData>{
 const units:EconomicUnit[]=[],reviews:EconomicReview[]=[],links:EconomicLink[]=[],publications:EconomicPublication[]=[];
 for(let offset=0;;offset+=500){
  const result=await db.from('concert_economic_source').select('*').order('id').range(offset,offset+499);
  if(result.error)throw result.error;units.push(...result.data);if(result.data.length<500)break;
 }
 for(let offset=0;;offset+=500){
  const result=await db.from('concert_unit_links').select('*').order('id').range(offset,offset+499);
  if(result.error)throw result.error;links.push(...result.data);if(result.data.length<500)break;
 }
 // Include ancestors, descendants and competing candidates so a partial read
 // cannot turn an ambiguous or incomplete chain into a definitive balance.
 const selected=new Set(units.filter(u=>!recordId||u.source_record_id===recordId).map(u=>u.id));
 let changed=true;while(changed){changed=false;for(const l of links.filter(l=>!['rejected','out_of_horizon'].includes(l.status))){
  if(selected.has(l.later_unit_id)||selected.has(l.earlier_unit_id)){for(const id of [l.later_unit_id,l.earlier_unit_id])if(!selected.has(id)){selected.add(id);changed=true;}}
 }}
 const recordLinks:Array<{earlier_record_id:string;later_record_id:string;evidence:string}>=[];
 for(let offset=0;;offset+=500){const page=await db.from('concert_record_links').select('earlier_record_id,later_record_id,evidence').in('status',['candidate','confirmed']).order('id').range(offset,offset+499);if(page.error)throw page.error;recordLinks.push(...page.data);if(page.data.length<500)break;}
 const missingLines=recordLinks.filter(l=>!units.some(u=>u.source_record_id===l.later_record_id&&u.status!=='rejected')&&(!recordId||recordId===l.later_record_id||units.some(u=>selected.has(u.id)&&u.source_record_id===l.earlier_record_id)));
 const selectedUnits=units.filter(u=>selected.has(u.id));
 for(let offset=0;offset<selectedUnits.length;offset+=100){
  const result=await db.from('concert_economic_reviews').select('*').in('unit_id',selectedUnits.slice(offset,offset+100).map(u=>u.id));
  if(result.error)throw result.error;reviews.push(...result.data);
 }
 const documentIds=[...new Set(selectedUnits.map(u=>u.document_id).filter((id):id is string=>!!id))];
 for(let offset=0;offset<documentIds.length;offset+=100){
  const docs=await db.from('source_documents').select('id,extracted_text_hash,extraction_partial,status,quality_flags').in('id',documentIds.slice(offset,offset+100));
  if(docs.error)throw docs.error;
  for(const doc of docs.data){if(doc.status==='fetched'&&!doc.extraction_partial&&doc.extracted_text_hash&&!doc.quality_flags?.includes('corrupt_text'))
   for(const unit of selectedUnits.filter(u=>u.document_id===doc.id))unit.document_identity=`text:${doc.extracted_text_hash}`;}
 }
 const recordIds=[...new Set(selectedUnits.map(u=>u.source_record_id))];
 for(let offset=0;offset<recordIds.length;offset+=100){
  const ids=recordIds.slice(offset,offset+100);
  const records=await db.from('source_records').select('id,title,source_payload').in('id',ids);if(records.error)throw records.error;
  const latest=new Map<string,{id:string;status:string}>();
  for(let page=0;;page+=500){
   const jobs=await db.from('pipeline_jobs').select('id,source_record_id,status').in('source_record_id',ids).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page,page+499);
   if(jobs.error)throw jobs.error;for(const j of jobs.data)if(!latest.has(j.source_record_id))latest.set(j.source_record_id,j);
   if(jobs.data.length<500)break;
  }
  publications.push(...records.data.map(r=>({id:r.id,title:r.title,job_id:latest.get(r.id)?.id??null,job_status:latest.get(r.id)?.status??null,
   official_url:typeof r.source_payload?.record_url==='string'?r.source_payload.record_url:null})));
 }
 return {missingLines,units:selectedUnits,reviews,links:links.filter(l=>selected.has(l.later_unit_id)&&selected.has(l.earlier_unit_id)),publications};
}
