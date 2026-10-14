import type {SupabaseClient} from '@supabase/supabase-js';
import {proposeRecordLinks,publicationDate,type ConcertPublication} from './record-linking';
import {proposeUnitLinks,type ConcertUnitForLink} from './unit-linking';

/** Complete paginated search. A title mismatch must not hide a RESES/NIF match. */
export async function discoverConcertLinks(db:SupabaseClient,recordId?:string){
 const publications:ConcertPublication[]=[];
 for(let offset=0;;offset+=500){
  const page=await db.from('source_records').select('id,title,source_record_id,source_payload').eq('financing_type','concert').order('id').range(offset,offset+499);
  if(page.error)throw page.error;
  publications.push(...page.data);if(page.data.length<500)break;
 }
 const byRecord=new Map(publications.map(row=>[row.id,row]));
 const units:ConcertUnitForLink[]=[];
 for(let offset=0;;offset+=500){
  const page=await db.from('record_units').select('id,source_record_id,act_type,reses_code,provider_nif,service_code,observed_service_code,territory,origin_reference,period,evidence_quote')
   .neq('unit_key','legacy').neq('status','rejected').order('id').range(offset,offset+499);
  if(page.error)throw page.error;
  for(const unit of page.data){
   const record=byRecord.get(unit.source_record_id);if(!record)continue;
   units.push({id:unit.id,recordId:record.id,recordTitle:record.title,recordExternalId:record.source_record_id,
    publishedAt:publicationDate(record),actType:unit.act_type,resesCode:unit.reses_code,providerNif:unit.provider_nif,
    serviceCode:unit.service_code??unit.observed_service_code,territory:unit.territory,originReference:unit.origin_reference,
    period:unit.period,referenceText:unit.evidence_quote});
  }
  if(page.data.length<500)break;
 }
 const byUnit=new Map(units.map(unit=>[unit.id,unit]));
 const recordCandidates=proposeRecordLinks(publications).filter(link=>!recordId||link.laterRecordId===recordId||link.earlierRecordId===recordId);
 const unitCandidates=proposeUnitLinks(units).filter(link=>!recordId||byUnit.get(link.laterUnitId)?.recordId===recordId||byUnit.get(link.earlierUnitId)?.recordId===recordId);
 return {recordCandidates,unitCandidates,byUnit};
}

export async function storeConcertLinkProposals(db:SupabaseClient,recordId?:string){
 const result=await discoverConcertLinks(db,recordId);
 const {recordCandidates,unitCandidates,byUnit}=result;
 if(recordCandidates.length){
  const saved=await db.from('concert_record_links').upsert(recordCandidates.map(link=>({later_record_id:link.laterRecordId,earlier_record_id:link.earlierRecordId,
   link_kind:link.kind,matching_method:link.method,status:'candidate',evidence:link.evidence})),{onConflict:'later_record_id,earlier_record_id',ignoreDuplicates:true});
  if(saved.error)throw saved.error;
 }
 // Root is provisional for candidates. The transactional review resolves the
 // full confirmed chain again; a guessed root never enters the balance.
 for(let offset=0;offset<unitCandidates.length;offset+=100){
  const saved=await db.from('concert_unit_links').upsert(unitCandidates.slice(offset,offset+100).map(link=>({
   later_unit_id:link.laterUnitId,earlier_unit_id:link.earlierUnitId,root_unit_id:link.earlierUnitId,
   relation_kind:byUnit.get(link.laterUnitId)!.actType,
   matching_method:link.method,status:'candidate',evidence:link.evidence,
  })),{onConflict:'later_unit_id,earlier_unit_id',ignoreDuplicates:true});
  if(saved.error)throw saved.error;
 }
 return {records:recordCandidates.length,units:unitCandidates.length};
}
