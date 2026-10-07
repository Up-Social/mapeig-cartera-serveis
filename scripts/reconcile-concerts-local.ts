/** Idempotent local-only reconciliation of publication candidates and the official 605700 sample. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolve} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {extractConcertAnnexRows,extractProgram317Rows} from '../lib/concerts/annex-extraction';
import {proposeRecordLinks,type ConcertPublication} from '../lib/concerts/record-linking';
import {proposeUnitLinks,type ConcertUnitForLink} from '../lib/concerts/unit-linking';
import {archiveSource,archiveUnitSource,sha256} from '../lib/source-storage';

const status=JSON.parse(execFileSync('supabase',['status','-o','json'],{encoding:'utf8',env:{...process.env,SUPABASE_TELEMETRY_DISABLED:'1'}}));
if(status.API_URL!=='http://127.0.0.1:54321')throw Error('Aquest script només pot modificar el Supabase local 54321');
const db=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});

async function main(){
 const all:ConcertPublication[]=[];
 for(let offset=0;;offset+=1000){
  const result=await db.from('source_records').select('id,title,source_record_id,source_payload').eq('financing_type','concert').range(offset,offset+999);
  if(result.error)throw result.error;
  all.push(...(result.data??[]) as ConcertPublication[]);
  if((result.data??[]).length<1000)break;
 }
 const candidates=proposeRecordLinks(all);
 for(const link of candidates){
  const exists=await db.from('concert_record_links').select('id').eq('later_record_id',link.laterRecordId).eq('earlier_record_id',link.earlierRecordId).maybeSingle();
  if(exists.error)throw exists.error;
  if(exists.data)continue;
  const added=await db.from('concert_record_links').insert({later_record_id:link.laterRecordId,earlier_record_id:link.earlierRecordId,
   link_kind:link.kind,matching_method:link.method,status:'candidate',evidence:link.evidence});
  if(added.error)throw added.error;
 }
 console.log(`Concerts: ${all.length} publicacions; ${candidates.length} relacions candidates, cap de confirmada automàticament.`);

 const record=all.find(row=>row.source_record_id==='etauler:1:605700');
 if(!record)throw Error('No consta l’edicte 605700 en aquesta base local');
 const file=resolve('tests/fixtures/official/25-000163-AP-barcelona-etauler-605700.pdf');
 const bytes=readFileSync(file),digest=sha256(bytes);
 if(digest!=='31e7df4eb6babe1ccc68c94323a19234bd0c1f489a8331b8149fe0f314752683')throw Error('La mostra oficial no supera el SHA-256 esperat');
 const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8',maxBuffer:2_000_000});
 const rows=extractConcertAnnexRows(text);
 if(rows.length!==42||rows.reduce((sum,row)=>sum+row.quantity,0)!==44||rows.reduce((sum,row)=>sum+row.amountCents,0)!==11334081)
  throw Error('El desglossament no quadra amb el total de la resolució');

 const publicationUrl='https://tauler.seu-e.cat/detall?idEns=1&idEdicte=605700';
 const url=`${publicationUrl}#copia-pdf-csv-05CRMDG2R77WHMUQ7DD7GNUBAPU1JGH1`;
 const urlHash=createHash('sha256').update(url).digest('hex');
 let document=await db.from('source_documents').select('id,source_record_id,url,content_hash,storage_path,storage_sha256,mime_type')
  .eq('source_record_id',record.id).eq('url_hash',urlHash).maybeSingle();
 if(document.error)throw document.error;
 if(!document.data){
  const inserted=await db.from('source_documents').insert({source_record_id:record.id,url,url_hash:urlHash,document_type:'official_resolution',
   source_fields:['e-Tauler edicte 605700','CSV 05CRMDG2R77WHMUQ7DD7GNUBAPU1JGH1','còpia PDF local verificada'],
   status:'fetched',mime_type:'application/pdf',content_hash:digest,extracted_text:text,extracted_text_hash:sha256(Buffer.from(text)),
   text_length:text.length,text_preview:text.slice(0,600),extraction_method:'pdftotext-layout',
   quality_score:1,quality_flags:[],extraction_partial:false,chunk_count:0,byte_size:bytes.length,resolved_url:publicationUrl})
   .select('id,source_record_id,url,content_hash,storage_path,storage_sha256,mime_type').single();
  if(inserted.error)throw inserted.error;
  document={data:inserted.data,error:null} as typeof document;
 }
 const doc=document.data!;
 await archiveSource(db,doc,{bytes,mimeType:'application/pdf'});
 const prefix=`official:605700:${digest}:`;
 const existing=await db.from('record_units').select('id,unit_key').eq('source_record_id',record.id).like('unit_key',`${prefix}%`);
 if(existing.error)throw existing.error;
 const byKey=new Map((existing.data??[]).map(item=>[item.unit_key,item.id]));
 for(const row of rows){
  const key=`${prefix}${row.row}`;
  if(byKey.has(key))continue;
  const inserted=await db.from('record_units').insert({source_record_id:record.id,unit_key:key,provider_nif:row.nif,
   period:'2025',act_type:'award',amount:row.amountCents/100,document_id:doc.id,page:row.page,evidence_quote:row.quote,
   status:'draft',reses_code:row.resesCode,observed_service_code:row.serviceCode,territory:'Barcelona',municipality:row.territory,
   effective_start:row.effectiveStart,effective_end:row.effectiveEnd,quantity:row.quantity,
   disposition_number:row.dispositionNumber,extraction_origin:'official-pdf:605700:pdftotext-layout-v1',horizon_state:'in_scope'})
   .select('id').single();
  if(inserted.error)throw inserted.error;
  byKey.set(key,inserted.data.id);
 }
 for(const row of rows){
  const id=byKey.get(`${prefix}${row.row}`)!;
  const corrected=await db.from('record_units').update({territory:'Barcelona',municipality:row.territory})
   .eq('id',id).eq('status','draft').eq('extraction_origin','official-pdf:605700:pdftotext-layout-v1').is('municipality',null);
  if(corrected.error)throw corrected.error;
 }
 for(const id of byKey.values())await archiveUnitSource(db,record.id,id);
 // The old single provision is retained for audit, but cannot stand for 44 services.
 const legacyProvision=await db.from('service_provisions').select('id,unit_id,superseded_at').eq('source_record_id',record.id).is('superseded_at',null);
 if(legacyProvision.error)throw legacyProvision.error;
 for(const provision of legacyProvision.data??[]){
  const unit=await db.from('record_units').select('unit_key').eq('id',provision.unit_id).single();
  if(unit.error)throw unit.error;
  if(unit.data.unit_key!=='legacy')continue;
  const updated=await db.from('service_provisions').update({superseded_at:new Date().toISOString()}).eq('id',provision.id).is('superseded_at',null);
  if(updated.error)throw updated.error;
 }
 console.log(`Edicte 605700: ${rows.length} línies proposades; 44 serveis; 113.340,81 €; ${byKey.size} còpies per línia a Storage local.`);

 const lleidaRecord=all.find(row=>row.source_record_id==='etauler:1:605699');
 if(!lleidaRecord)throw Error('No consta l’edicte 605699 en aquesta base local');
 const lleidaDoc=await db.from('source_documents').select('id,source_record_id,url,content_hash,storage_path,storage_sha256,mime_type')
  .eq('source_record_id',lleidaRecord.id).eq('storage_sha256','0dd5bbe980b649a39dd3fdb7dc8a388ab2f9c47b4d91d92b44fa5db2fae50a73').single();
 if(lleidaDoc.error||!lleidaDoc.data?.storage_path)throw lleidaDoc.error??Error('PDF 605699 absent del Storage local');
 const lleidaCopy=await db.storage.from('cloud-documents').download(lleidaDoc.data.storage_path);
 if(lleidaCopy.error||!lleidaCopy.data)throw lleidaCopy.error??Error('PDF 605699 no disponible');
 const lleidaBytes=Buffer.from(await lleidaCopy.data.arrayBuffer());
 const lleidaHash=sha256(lleidaBytes);
 if(lleidaHash!=='0dd5bbe980b649a39dd3fdb7dc8a388ab2f9c47b4d91d92b44fa5db2fae50a73'||lleidaHash!==lleidaDoc.data.storage_sha256)
  throw Error('PDF 605699: la còpia no supera la integritat esperada');
 const lleidaTemporary=mkdtempSync(join(tmpdir(),'mapeig-lleida-'));
 let lleidaText='';
 try{
  const path=join(lleidaTemporary,'resolution.pdf');writeFileSync(path,lleidaBytes);
  lleidaText=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8',maxBuffer:2_000_000});
 }finally{rmSync(lleidaTemporary,{recursive:true,force:true});}
 const lleidaRows=extractConcertAnnexRows(lleidaText);
 if(lleidaRows.length!==2||lleidaRows.reduce((n,row)=>n+row.quantity,0)!==5||lleidaRows.reduce((n,row)=>n+row.amountCents,0)!==1490228)
  throw Error('El desglossament de Lleida no quadra amb el total de la resolució');
 const lleidaUpdated=await db.from('source_documents').update({status:'fetched',mime_type:'application/pdf',content_hash:lleidaHash,
  extracted_text:lleidaText,extracted_text_hash:sha256(Buffer.from(lleidaText)),text_length:lleidaText.length,
  text_preview:lleidaText.slice(0,600),extraction_method:'pdftotext-layout',quality_score:1,quality_flags:[],
  extraction_partial:false,byte_size:lleidaBytes.length}).eq('id',lleidaDoc.data.id).eq('source_record_id',lleidaRecord.id);
 if(lleidaUpdated.error)throw lleidaUpdated.error;
 const lleidaPrefix=`official:605699:${lleidaHash}:`;
 const lleidaExisting=await db.from('record_units').select('id,unit_key').eq('source_record_id',lleidaRecord.id).like('unit_key',`${lleidaPrefix}%`);
 if(lleidaExisting.error)throw lleidaExisting.error;
 const lleidaByKey=new Map((lleidaExisting.data??[]).map(item=>[item.unit_key,item.id]));
 for(const row of lleidaRows){
  const key=`${lleidaPrefix}${row.row}`;
  if(lleidaByKey.has(key))continue;
  const inserted=await db.from('record_units').insert({source_record_id:lleidaRecord.id,unit_key:key,provider_nif:row.nif,
   period:'2025',act_type:'award',amount:row.amountCents/100,document_id:lleidaDoc.data.id,page:row.page,evidence_quote:row.quote,
   status:'draft',reses_code:row.resesCode,observed_service_code:row.serviceCode,territory:'Lleida',municipality:row.territory,
   effective_start:row.effectiveStart,effective_end:row.effectiveEnd,quantity:row.quantity,
   disposition_number:row.dispositionNumber,extraction_origin:'official-pdf:605699:pdftotext-layout-v1',horizon_state:'in_scope'})
   .select('id').single();
  if(inserted.error)throw inserted.error;
  lleidaByKey.set(key,inserted.data.id);
 }
 for(const id of lleidaByKey.values())await archiveUnitSource(db,lleidaRecord.id,id);
 console.log(`Edicte 605699: ${lleidaRows.length} línies proposades; 5 serveis; 14.902,28 €; ${lleidaByKey.size} còpies per línia a Storage local.`);

 const programRecord=all.find(row=>row.source_record_id==='etauler:1:511349');
 if(!programRecord)throw Error('No consta l’edicte 511349 en aquesta base local');
 const programDoc=await db.from('source_documents').select('id,source_record_id,url,content_hash,storage_path,storage_sha256,mime_type')
  .eq('source_record_id',programRecord.id).eq('mime_type','application/pdf').not('storage_path','is',null).single();
 if(programDoc.error)throw programDoc.error;
 const downloaded=await db.storage.from('cloud-documents').download(programDoc.data.storage_path);
 if(downloaded.error||!downloaded.data)throw downloaded.error??Error('PDF 511349 absent del Storage local');
 const programBytes=Buffer.from(await downloaded.data.arrayBuffer());
 if(sha256(programBytes)!==programDoc.data.storage_sha256)throw Error('PDF 511349: còpia no íntegra');
 const temporary=mkdtempSync(join(tmpdir(),'mapeig-program-317-'));
 let programText='';
 try{
  const path=join(temporary,'resolution.pdf');writeFileSync(path,programBytes);
  programText=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8',maxBuffer:2_000_000});
 }finally{rmSync(temporary,{recursive:true,force:true});}
 const programRows=extractProgram317Rows(programText);
 if(programRows.length!==89)throw Error(`Pròrroga 511349: s’esperaven 89 files documentals, se n’han trobat ${programRows.length}`);
 const programPrefix=`official:511349:${programDoc.data.storage_sha256}:`;
 const previous=await db.from('record_units').select('id,unit_key').eq('source_record_id',programRecord.id).like('unit_key',`${programPrefix}%`);
 if(previous.error)throw previous.error;
 const programByKey=new Map((previous.data??[]).map(item=>[item.unit_key,item.id]));
 for(const row of programRows){
  const key=`${programPrefix}${row.row}`;
  if(programByKey.has(key))continue;
  const inserted=await db.from('record_units').insert({source_record_id:programRecord.id,unit_key:key,provider_nif:row.nif,
   period:'2024',act_type:'renewal',amount:null,document_id:programDoc.data.id,page:row.page,evidence_quote:row.quote,status:'draft',
   reses_code:row.resesCode,territory:'Barcelona',disposition_number:row.dispositionNumber,
   extraction_origin:'official-pdf:511349:pdftotext-layout-v1',horizon_state:'pre_2024_origin_unavailable'})
   .select('id').single();
  if(inserted.error)throw inserted.error;
  programByKey.set(key,inserted.data.id);
 }
 for(const id of programByKey.values())await archiveUnitSource(db,programRecord.id,id);
 console.log(`Edicte 511349: ${programRows.length} línies proposades; import per línia desconegut; origen anterior a 2024 pendent; ${programByKey.size} còpies per línia a Storage local.`);

 const publicationById=new Map(all.map(item=>[item.id,item]));
 const unitRows=[];
 for(let offset=0;;offset+=1000){
  const result=await db.from('record_units').select('id,source_record_id,act_type,reses_code,provider_nif,service_code,observed_service_code,territory,origin_reference,period')
   .neq('unit_key','legacy').range(offset,offset+999);
  if(result.error)throw result.error;
  unitRows.push(...(result.data??[]));
  if((result.data??[]).length<1000)break;
 }
 const forLink:ConcertUnitForLink[]=unitRows.flatMap(unit=>{
  const publication=publicationById.get(unit.source_record_id);
  return publication?[{id:unit.id,recordId:unit.source_record_id,recordTitle:publication.title,recordExternalId:publication.source_record_id,
   publishedAt:typeof publication.source_payload.data_publicacio==='string'?publication.source_payload.data_publicacio.slice(0,10):'',
   actType:unit.act_type,resesCode:unit.reses_code,providerNif:unit.provider_nif,
   serviceCode:unit.service_code??unit.observed_service_code,territory:unit.territory,originReference:unit.origin_reference,period:unit.period}]:[];
 });
 const unitCandidates=proposeUnitLinks(forLink);
 const unitById=new Map(forLink.map(unit=>[unit.id,unit]));
 for(const link of unitCandidates){
  const exists=await db.from('concert_unit_links').select('id').eq('later_unit_id',link.laterUnitId).eq('earlier_unit_id',link.earlierUnitId).maybeSingle();
  if(exists.error)throw exists.error;
  if(exists.data)continue;
  const later=unitById.get(link.laterUnitId)!;
  const relation=({modification:'delta',amendment:'amendment',renewal:'renewal',termination:'termination',cession:'cession',appeal:'appeal',validation:'validation'} as Record<string,string>)[later.actType];
  const inserted=await db.from('concert_unit_links').insert({later_unit_id:link.laterUnitId,earlier_unit_id:link.earlierUnitId,
   root_unit_id:link.earlierUnitId,relation_kind:relation,matching_method:link.method,status:'candidate',evidence:link.evidence});
  if(inserted.error)throw inserted.error;
 }
 console.log(`Línies: ${forLink.length} disponibles; ${unitCandidates.length} vincles candidats, cap de confirmat automàticament.`);
}

main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
