import type {CloudDb} from './context';
import {CloudFailure} from './errors';
import type {Enrichment} from '../pipeline/enrichment-contract';
import {readPages} from '../read-pages';
import {readEvidenceChunks,type EvidenceRow} from '../pipeline/evidence-reader';
import {currentDocumentTextConsistent} from '../concerts/document-text-integrity';
import {concertSignedAuthority,projectConcertDocumentaryFacts} from '../concerts/documentary-facts';
import {extractColumnManagerObservations} from '../concerts/annex-extraction';
import {concertLineAmountSummary} from '../concerts/line-summary';
import {hasCurrentTextCoverage} from '../pipeline/document-coverage';
import {provisionalServiceAmounts} from '../concerts/provisional-headings';

/** Only three display facts are corrected, with document-level provenance.
 * The original model response, roles, money and review state remain untouched. */
export async function projectConcertEnrichment(db:CloudDb,recordId:string,result:Enrichment):Promise<{enrichment:Enrichment;evidence:EvidenceRow[]}>{
 const unchanged={enrichment:result,evidence:[]};
 const reports=await db.from('concert_annex_reconciliations').select('document_id,document_sha256,annex,row_count,sum_cents,reconciled').eq('source_record_id',recordId).eq('reconciled',true);
 if(reports.error)throw new CloudFailure('internal',5,{operation:'concert_documentary_enrichment',code:'DOCUMENTARY_FACTS_QUERY_FAILED'});
 if(!reports.data.length){
  const [source,documents]=await Promise.all([
   db.from('source_records').select('title').eq('id',recordId).maybeSingle(),
   readPages((from,to)=>db.from('source_documents').select('id,status,mime_type,storage_path,storage_sha256,active_extraction_id,extracted_text,extracted_text_hash,extraction_method,extraction_partial,extraction_coverage,quality_flags').eq('source_record_id',recordId).eq('status','fetched').eq('mime_type','application/pdf').order('id').range(from,to)),
  ]);
  if(source.error)throw new CloudFailure('internal',5,{operation:'concert_documentary_enrichment',code:'DOCUMENTARY_FACTS_QUERY_FAILED'});
  if(!source.data?.title||documents.length!==1)return unchanged;
  const document=documents[0];
  if(!currentDocumentTextConsistent(document)||document.extraction_partial!==false||document.quality_flags?.some((flag:string)=>['corrupt_text','incomplete_extraction'].includes(flag))||!hasCurrentTextCoverage(document.extraction_method,document.extraction_coverage,document.mime_type,document.extraction_partial))return unchanged;
  const rows=provisionalServiceAmounts(source.data.title,document.extracted_text!);
  if(!rows)return unchanged;
  const chunks=await readEvidenceChunks(db,[document.id]);
  const printable=(cents:number)=>(cents/100).toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  const evidence=chunks.filter(chunk=>/\bImport\s+total\b/i.test(chunk.content)&&rows.some(row=>chunk.content.includes(printable(row.grossCents))));
  if(rows.some(row=>!evidence.some(chunk=>chunk.content.includes(printable(row.grossCents)))))return unchanged;
  const scopeFacts={...result.scope_facts,provisional_document_amounts:{version:'concert-provisional-amounts-v1',document_id:document.id,
   document_sha256:document.storage_sha256,extraction_id:document.active_extraction_id,extracted_text_hash:document.extracted_text_hash,
   rows,total_cents:rows.reduce((sum,row)=>sum+row.grossCents,0),original_model_amount:result.amount,original_model_summary:result.summary}};
  return {enrichment:{...result,amount:null,summary:`Proposta provisional amb ${rows.length} serveis descrits a l’annex; els imports són propostes pendents de revisar, no finançament adjudicat.`,scope_facts:scopeFacts},evidence};
 }
 if(reports.data.length!==1)return unchanged;
 const [document,units]=await Promise.all([
  db.from('source_documents').select('id,url,document_type,status,mime_type,storage_path,storage_sha256,active_extraction_id,extracted_text,extracted_text_hash,extraction_method,extraction_partial,extraction_coverage,quality_flags').eq('source_record_id',recordId).eq('id',reports.data[0].document_id).maybeSingle(),
  readPages((from,to)=>db.from('record_units').select('id,unit_key,document_id,storage_sha256,page,provider_nif,reses_code,observed_service_code,quantity,amount,evidence_quote,act_type').eq('source_record_id',recordId).neq('unit_key','legacy').order('id').range(from,to)),
 ]);
 if(document.error)throw new CloudFailure('internal',5,{operation:'concert_documentary_enrichment',code:'DOCUMENTARY_FACTS_QUERY_FAILED'});
 const d=document.data;
 if(!d||!currentDocumentTextConsistent(d))return unchanged;
 const projection=projectConcertDocumentaryFacts([{
  id:d.id,url:d.url,documentType:d.document_type,sourceFields:[],status:d.status,
  revision:`${d.storage_sha256}:${d.active_extraction_id}`,currentTextConsistent:true,archived:true,
  extractedText:d.extracted_text,mimeType:d.mime_type,textPreview:null,textLength:d.extracted_text.length,
  extractionMethod:d.extraction_method,extractionPartial:d.extraction_partial,extractionCoverage:d.extraction_coverage,
  qualityFlags:d.quality_flags??[],qualityScore:null,chunkCount:0,
 }],units,reports.data);
 if(!projection){
  // The signature and printed management centre do not depend on the optional
  // support column. Preserve summary/population when line semantics are unclear.
  const sum=concertLineAmountSummary(units,reports.data,true);
  const sourceText=d.extracted_text!.replace(/\s+/g,' ').trim();
  if(sum.reason!==null||!d.mime_type?.includes('pdf')||d.extraction_partial!==false||d.quality_flags?.some((flag:string)=>['corrupt_text','incomplete_extraction'].includes(flag))||!hasCurrentTextCoverage(d.extraction_method,d.extraction_coverage,d.mime_type,d.extraction_partial)||
   units.some(unit=>!unit.evidence_quote||!sourceText.includes(unit.evidence_quote.replace(/\s+/g,' ').trim())))return unchanged;
  const signer=concertSignedAuthority(d.extracted_text!);
  const managers=extractColumnManagerObservations(d.extracted_text!);
  if(!signer&&!managers.length)return unchanged;
  const evidence=await readEvidenceChunks(db,[d.id]);
  if(!evidence.length)throw new CloudFailure('validation',5,{operation:'concert_documentary_enrichment',code:'DOCUMENTARY_FACTS_EVIDENCE_MISSING'});
  const scopeFacts={...result.scope_facts,documentary_authority:{
   version:'concert-documentary-authority-v1',document_id:d.id,document_sha256:d.storage_sha256,extraction_id:d.active_extraction_id,
   extracted_text_hash:d.extracted_text_hash,authority:signer,manager_codes:managers,
  }};
  return {enrichment:{...result,contracting_body:signer?.value??result.contracting_body,scope_facts:scopeFacts},evidence};
 }
 const evidence=await readEvidenceChunks(db,[d.id]);
 if(!evidence.length)throw new CloudFailure('validation',5,{operation:'concert_documentary_enrichment',code:'DOCUMENTARY_FACTS_EVIDENCE_MISSING'});
 const scopeFacts={...result.scope_facts,documentary_projection:{
  version:'concert-documentary-facts-v1',document_id:d.id,document_sha256:d.storage_sha256,
  extraction_id:d.active_extraction_id,extracted_text_hash:d.extracted_text_hash,line_count:projection.lineCount,
  applied_fields:['summary',...(projection.populations?['target_population']:[]),...(projection.authority?['contracting_body']:[])],
  fields:{summary:{services:projection.services},target_population:{values:projection.populations,services:projection.services},contracting_body:projection.authority,documentary_period:projection.period,manager_codes:projection.managerCodes},
 }};
 return {enrichment:{...result,summary:projection.summary,target_population:projection.populations?.join(' · ')??result.target_population,
  contracting_body:projection.authority?.value??result.contracting_body,scope_facts:scopeFacts},evidence};
}
