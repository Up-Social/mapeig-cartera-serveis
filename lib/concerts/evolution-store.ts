import {recoverConcertDisplayNames} from './presentation';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {ConcertEvolutionData,EconomicUnit,EconomicReview,EconomicLink,EconomicPublication} from './evolution';
import {lineReadersEnabled,requireConsistentLineReads} from './line-read-guard';
import {applyVerifiedLineStates} from './line-evolution-state';

export async function loadConcertEvolution(db:SupabaseClient,recordId?:string):Promise<ConcertEvolutionData>{
 await requireConsistentLineReads(db);
 const units:EconomicUnit[]=[],reviews:EconomicReview[]=[],links:EconomicLink[]=[],publications:EconomicPublication[]=[];
 for(let offset=0;;offset+=500){
  const result=await db.from('concert_economic_source').select('*').order('id').range(offset,offset+499);
  if(result.error)throw result.error;units.push(...result.data);if(result.data.length<500)break;
 }
 for(let offset=0;;offset+=500){
  const result=await db.from('concert_unit_links').select('*').order('id').range(offset,offset+499);
  if(result.error)throw result.error;links.push(...result.data);if(result.data.length<500)break;
 }
 // Include linked ancestors/descendants and all lines of their source documents.
 // A still-unlinked sibling must not disappear from the record-level picture.
 const siblings=new Map<string,string[]>(),byRecord=new Map<string,string[]>(),withoutDocument=new Map<string,string[]>(),adjacent=new Map<string,string[]>(),byId=new Map(units.map(unit=>[unit.id,unit]));
 for(const unit of units){
  const recordUnits=byRecord.get(unit.source_record_id)??[];recordUnits.push(unit.id);byRecord.set(unit.source_record_id,recordUnits);
  if(unit.document_id){
   const key=JSON.stringify([unit.source_record_id,unit.document_id]),ids=siblings.get(key)??[];
   ids.push(unit.id);siblings.set(key,ids);
  }else{const ids=withoutDocument.get(unit.source_record_id)??[];ids.push(unit.id);withoutDocument.set(unit.source_record_id,ids);}
 }
 for(const link of links.filter(l=>!['rejected','out_of_horizon'].includes(l.status))){
  for(const [a,b] of [[link.later_unit_id,link.earlier_unit_id],[link.earlier_unit_id,link.later_unit_id]]){
   const ids=adjacent.get(a)??[];ids.push(b);adjacent.set(a,ids);
  }
 }
 const selected=new Set(units.filter(u=>!recordId||u.source_record_id===recordId).map(u=>u.id));
 const queue=[...selected],seenDocuments=new Set<string>(),seenUnknown=new Set<string>(),seenRecords=new Set<string>();
 const add=(id:string)=>{if(!selected.has(id)){selected.add(id);queue.push(id);}};
 for(let index=0;index<queue.length;index++){
  const id=queue[index],unit=byId.get(id);
  for(const next of adjacent.get(id)??[])add(next);
  if(unit?.document_id){const key=JSON.stringify([unit.source_record_id,unit.document_id]);
   if(!seenDocuments.has(key)){seenDocuments.add(key);for(const sibling of siblings.get(key)??[])add(sibling);}
   if(!seenUnknown.has(unit.source_record_id)){seenUnknown.add(unit.source_record_id);for(const sibling of withoutDocument.get(unit.source_record_id)??[])add(sibling);}
  }else if(unit&&!seenRecords.has(unit.source_record_id)){
   seenRecords.add(unit.source_record_id);for(const sibling of byRecord.get(unit.source_record_id)??[])add(sibling);
  }
 }
 const recordLinks:Array<{earlier_record_id:string;later_record_id:string;evidence:string;link_kind:string}>=[];
 for(let offset=0;;offset+=500){const page=await db.from('concert_record_links').select('earlier_record_id,later_record_id,evidence,link_kind').in('status',['candidate','confirmed']).order('id').range(offset,offset+499);if(page.error)throw page.error;recordLinks.push(...page.data);if(page.data.length<500)break;}
 const selectedRecords=new Set([...selected].map(id=>byId.get(id)?.source_record_id).filter((id):id is string=>!!id));
 const confirmedLinePairs=new Set(links.filter(link=>link.status==='confirmed').flatMap(link=>{
  const earlier=byId.get(link.earlier_unit_id);
  return earlier?.status==='approved'&&!['out_of_scope','pre_2024_origin_unavailable'].includes(earlier.horizon_state??'')?[JSON.stringify([link.later_unit_id,earlier.source_record_id])]:[];
 }));
 // A record-level candidate does not identify individual lines. The existence
 // of one extracted line alone cannot resolve it: every in-scope later line
 // needs a confirmed link to a line of this earlier publication. A candidate
 // is still pending and must not restore a definitive balance.
 // Calls are procedural context, not economic amendments.
 const missingLines=recordLinks.filter(l=>{
  if(l.link_kind==='call'||(recordId&&recordId!==l.later_record_id&&!selectedRecords.has(l.earlier_record_id)))return false;
  const later=(byRecord.get(l.later_record_id)??[]).map(id=>byId.get(id)!).filter(u=>u.status!=='rejected');
  if(!later.length)return true;
  const inScope=later.filter(u=>!['out_of_scope','pre_2024_origin_unavailable'].includes(u.horizon_state??''));
  return inScope.some(u=>!confirmedLinePairs.has(JSON.stringify([u.id,l.earlier_record_id])));
 });
 const selectedUnits=units.filter(u=>selected.has(u.id));
 if(lineReadersEnabled()){
  for(let offset=0;offset<selectedUnits.length;offset+=100){
   const page=selectedUnits.slice(offset,offset+100);const result=await db.rpc('concert_line_evolution_states',{p_units:page.map(unit=>unit.id)});
   if(result.error)throw result.error;
   const verified=applyVerifiedLineStates(page,result.data??[]);
   for(let index=0;index<page.length;index++)Object.assign(page[index],verified[index]);
  }
 }
 for(let offset=0;offset<selectedUnits.length;offset+=100){
  const result=await db.from('concert_economic_reviews').select('*').in('unit_id',selectedUnits.slice(offset,offset+100).map(u=>u.id));
  if(result.error)throw result.error;reviews.push(...result.data);
 }
 if(process.env.CONCERT_SUPPLEMENTAL_GEOGRAPHY_ENABLED==='true'&&process.env.CONCERT_SUPPLEMENTAL_GEOGRAPHY_REVIEW_ENABLED==='true'){
  for(let offset=0;offset<selectedUnits.length;offset+=100){
   const page=selectedUnits.slice(offset,offset+100);
   const geography=await db.from('current_concert_supplemental_geography_review').select('*').in('unit_id',page.map(u=>u.id));
   if(geography.error)throw geography.error;
   const byUnit=new Map((geography.data??[]).map(g=>[g.unit_id,g]));
   for(const unit of page)unit.supplemental_geography=byUnit.get(unit.id)??null;
  }
 }
 const displayDocuments:Array<{id:string;extracted_text:string|null}>=[];
 const documentIds=[...new Set(selectedUnits.map(u=>u.document_id).filter((id):id is string=>!!id))];
 for(let offset=0;offset<documentIds.length;offset+=100){
  const docs=await db.from('source_documents').select('id,extracted_text,extracted_text_hash,extraction_partial,status,quality_flags').in('id',documentIds.slice(offset,offset+100));
  if(docs.error)throw docs.error;displayDocuments.push(...docs.data.filter(d=>d.status==='fetched'&&!d.extraction_partial&&!d.quality_flags?.includes('corrupt_text')));
  for(const doc of docs.data){if(doc.status==='fetched'&&!doc.extraction_partial&&doc.extracted_text_hash&&!doc.quality_flags?.includes('corrupt_text'))
   for(const unit of selectedUnits.filter(u=>u.document_id===doc.id))unit.document_identity=`text:${doc.extracted_text_hash}`;}
 }
 const recordIds=[...new Set(selectedUnits.map(u=>u.source_record_id))];
 for(let offset=0;offset<recordIds.length;offset+=100){
  const ids=recordIds.slice(offset,offset+100);
  const records=await db.from('source_records').select('id,title,source_payload').in('id',ids);if(records.error)throw records.error;
  const latest=new Map<string,{id:string;status:string}>();
  for(let page=0;;page+=500){
   const jobs=await db.from('pipeline_jobs').select('id,source_record_id,status').in('source_record_id',ids).eq('verification_only',false).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page,page+499);
   if(jobs.error)throw jobs.error;for(const j of jobs.data)if(!latest.has(j.source_record_id))latest.set(j.source_record_id,j);
   if(jobs.data.length<500)break;
  }
  publications.push(...records.data.map(r=>({id:r.id,title:r.title,job_id:latest.get(r.id)?.id??null,job_status:latest.get(r.id)?.status??null,
   official_url:typeof r.source_payload?.record_url==='string'?r.source_payload.record_url:null})));
 }
 await requireConsistentLineReads(db);
 return {missingLines,units:recoverConcertDisplayNames(selectedUnits,displayDocuments),reviews,links:links.filter(l=>selected.has(l.later_unit_id)&&selected.has(l.earlier_unit_id)),publications};
}
