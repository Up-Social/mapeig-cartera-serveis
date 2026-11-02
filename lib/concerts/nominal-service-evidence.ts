import {createHash} from 'node:crypto';
import {hasCurrentTextCoverage} from '../pipeline/document-coverage';
import type {NominalServiceEvidence} from './nominal-service-proposal';
type Unit={document_id:string|null;storage_sha256:string|null;storage_path:string|null;page:number|null;evidence_quote:string|null;observed_service_name:string|null;observed_service_code:string|null;service_code:string|null;act_type:string;extraction_origin:string|null};
type Document={id:string;storage_sha256:string|null;extracted_text:string|null;extracted_text_hash:string|null;extraction_method:string|null;extraction_coverage:unknown;mime_type:string|null;extraction_partial:boolean|null;quality_flags:string[]|null};
const normalized=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/** Compare immutable anchors with the actual extracted page; not a verification of the PDF bytes. */
export function nominalServiceEvidence(unit:Unit,docs:Document[]):NominalServiceEvidence|null{
 if(unit.act_type!=='award'||unit.extraction_origin!=='official-resolc-v1'||unit.observed_service_code||unit.service_code||!unit.document_id||!unit.storage_sha256||!unit.storage_path||!unit.page||!unit.evidence_quote||!unit.observed_service_name)return null;
 const matching=docs.filter(d=>d.id===unit.document_id);if(matching.length!==1)return null;
 const doc=matching[0],text=doc.extracted_text;
 if(!text||doc.storage_sha256!==unit.storage_sha256||doc.mime_type!=='application/pdf'||doc.extraction_partial!==false||!doc.extraction_coverage||typeof doc.extraction_coverage!=='object'||!('complete' in doc.extraction_coverage)||doc.extraction_coverage.complete!==true||doc.quality_flags?.some(f=>['corrupt_text','incomplete_extraction'].includes(f))||!hasCurrentTextCoverage(doc.extraction_method,doc.extraction_coverage,doc.mime_type,doc.extraction_partial)||!doc.extracted_text_hash||createHash('sha256').update(text).digest('hex')!==doc.extracted_text_hash)return null;
 const header=`## Pàgina ${unit.page}\n`,parts=text.split(header);if(parts.length!==2)return null;
 const page=parts[1].split(/\n## Pàgina \d+\n/)[0];
 const quote=normalized(unit.evidence_quote),name=normalized(unit.observed_service_name);
 if(!quote||!name||!normalized(page).includes(quote)||!quote.includes(name))return null;
 return {name:unit.observed_service_name,page:unit.page,documentId:unit.document_id};
}
