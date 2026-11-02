import {effectiveUnitCode,type DocumentedCorrection} from '../human-resolution';
import {readPages} from '../read-pages';
import type {AnalysisOutput} from '../analysis-contract';
import type {OfficialService} from '../official-catalog';
import type {Context} from './context';

export const PROGRAM_EVIDENCE_BINDING_VERSION='program-line-evidence-v1';
type ProgramLineEvidence={id:string;document_id:string;reses_code:string|null;unit_key:string;observed_service_name:string|null;evidence_quote:string|null};
type ProgramChunk={content:string;source_document_id:string};
/** Each service needs its own literal observation or a current human citation. */
export function programLineEvidenceOrdinals(line:ProgramLineEvidence,corrections:DocumentedCorrection[],chunks:ProgramChunk[]):number[]{
 const normalized=(value:string)=>value.replace(/\s+/g,' ').trim();
 const correction=corrections.find(c=>c.valid&&c.unit_id===line.id&&c.field==='service_code');
 if(correction){
  const citation=normalized(correction.evidence);
  if(citation.length<12)return [];
  return chunks.flatMap((chunk,index)=>chunk.source_document_id===correction.document_id&&normalized(chunk.content).includes(citation)?[index+1]:[]);
 }
 const code=line.reses_code??line.unit_key.match(/:([SC]\d{5}):\d+$/)?.[1];
 const name=normalized(line.observed_service_name??''),quote=normalized(line.evidence_quote??'');
 if(!code||name.length<12||!quote)return [];
 const start=quote.indexOf(code),end=start<0?-1:quote.indexOf(name,start+code.length);
 if(end<0)return [];
 const span=quote.slice(start,end+name.length);
 // A later RESES marks a different row; its service cannot validate this one.
 if(/\b[SC]\d{5}\b/.test(span.slice(code.length)))return [];
 return chunks.flatMap((chunk,index)=>chunk.source_document_id===line.document_id&&normalized(chunk.content).includes(span)?[index+1]:[]);
}

export async function programAnalysis(c:Pick<Context,'db'>,recordId:string,catalog:OfficialService[],chunks:Array<{content:string;source_document_id:string}>){
 const report={data:await readPages((from,to)=>c.db.from('concert_annex_reconciliations').select('*').eq('source_record_id',recordId).eq('extraction_version','program-columns-v2').order('id').range(from,to))};
 if(!report.data.length)return null;
 const lines={data:await readPages((from,to)=>c.db.from('record_units').select('id,document_id,page,reses_code,unit_key,observed_service_code,observed_service_name,evidence_quote,amount,storage_path,storage_sha256').eq('source_record_id',recordId).eq('extraction_origin','program-columns-v2').order('id').range(from,to))};
 const diagnostics:Array<Record<string,unknown>>=[];
 for(const r of report.data){
  if(!r.coverage?.complete)diagnostics.push({code:'incomplete_annex',message:`Annex parcial: ${r.coverage?.extractedRows??r.row_count} línies llegides de ${r.coverage?.candidateRows??'nombre desconegut'}.`,documentId:r.document_id,action:'enrich',rule:'annex_coverage'});
  if(!r.reconciled)diagnostics.push({code:'unreconciled_amount',message:'La suma de les línies encara no està conciliada amb el total documental, o hi ha canvis pendents sobre línies revisades.',documentId:r.document_id,action:'units',rule:'annex_reconciliation'});
 }
 const corrected={data:await readPages((from,to)=>c.db.from('current_documented_corrections').select('*').eq('source_record_id',recordId).order('id').range(from,to))};
 for(const correction of corrected.data.filter(row=>!row.valid))diagnostics.push({code:'correction_source_changed',message:'La font d’una correcció humana ha canviat. Cal revisar-la de nou.',unitId:correction.unit_id,documentId:correction.document_id,page:correction.page,action:'units',rule:'human_source_version'});
 const groups=new Map<string,{service:OfficialService;ordinals:Set<number>;units:string[]}>();
 for(const line of lines.data){
  const service=catalog.find(s=>s.service_code===effectiveUnitCode(line,corrected.data)&&s.benefit_type==='service');
  const code=line.reses_code??line.unit_key.match(/:([SC]\d{5}):\d+$/)?.[1];
  const ordinals=programLineEvidenceOrdinals(line,corrected.data,chunks);
  const source=report.data.find(r=>r.document_id===line.document_id);
  if(!service||!ordinals.length||!line.storage_path||!source||line.storage_sha256!==source.document_sha256){
   const visual=corrected.data.find(c=>c.valid&&c.unit_id===line.id&&c.field==='service_code'&&c.visual_check);
   const reason=!service?'la tipologia impresa no identifica un codi acreditat':!line.storage_path||!source||line.storage_sha256!==source.document_sha256?'falta la còpia arxivada verificable':visual?'la correcció visual es conserva, però no es pot vincular a un fragment literal; cal revisar-la':'falta el fragment documental de la línia';
   diagnostics.push({code:visual&&!ordinals.length?'visual_correction_needs_review':'unresolved_line',message:`Línia ${code??line.id}: ${reason}.`,documentId:line.document_id,page:line.page,unitId:line.id,action:'units',rule:'line_evidence'});continue;
  }
  const group=groups.get(service.service_code)??{service,ordinals:new Set<number>(),units:[]};
  ordinals.forEach(n=>group.ordinals.add(n));group.units.push(line.id);groups.set(service.service_code,group);
 }
 const evidence=[...new Set([...groups.values()].flatMap(g=>[...g.ordinals]))];
 if(!evidence.length){
  if(!chunks.length)return null; // The caller's no-evidence policy handles this case.
  diagnostics.push({code:'no_program_line_evidence',message:'Cap línia té un fragment propi acreditat; cal revisar l’annex abans de classificar.',action:'units',rule:'line_evidence'});
  const sameDocument=chunks.findIndex(chunk=>report.data.some(r=>r.document_id===chunk.source_document_id));
  evidence.push(sameDocument<0?1:sameDocument+1);
 }
 const expected=report.data.reduce((n,r)=>n+r.row_count,0);
 if(lines.data.length!==expected)diagnostics.push({code:'line_count_mismatch',message:`Hi ha ${lines.data.length} línies guardades i ${expected} observacions documentals; cal revisar la cobertura.`,action:'units',rule:'line_count'});
 const valid=diagnostics.length===0;
 const result:AnalysisOutput&{rule_audit:Record<string,unknown>;model_conclusion:null}={
  classification:valid?'in_portfolio':'insufficient_evidence',reasons:[],
  explanation:valid?`S’han llegit ${lines.data.length} línies de ${groups.size} tipologies amb evidència pròpia i imports conciliats. Les pròrrogues i modificacions requereixen vincular l’original i revisar els efectes abans de calcular el saldo vigent.`:diagnostics.map(d=>d.message).join(' '),
  service_description:[...groups.values()].map(g=>g.service.service_name).join(' · '),
  target_population:[...new Set([...groups.values()].map(g=>g.service.target_population||`Destinataris de la tipologia acreditada: ${g.service.service_name}`).filter(Boolean))].join(' · '),
  evidence_ordinals:evidence,population_verified:valid,social_service_verified:valid,
  candidates:valid?[...groups.values()].map(g=>({code:g.service.service_code,score:1,population_compatible:true,legal_reference:g.service.legal_reference,
   rationale:`Tipologia documental acreditada en ${g.units.length} línies; es conserva el nivell del catàleg que descriu l’annex.`,
   evidence_ordinals:[...g.ordinals],evidence_explanation:'Tipologia del servei vinculada a la seva evidència documental. La població destinatària de cada línia resta pendent de contrast documental.'})):[],
  rule_audit:{version:'concert-program-lines-v2',evidence_binding_version:PROGRAM_EVIDENCE_BINDING_VERSION,diagnostics,line_count:lines.data.length,groups:[...groups.values()].map(g=>({code:g.service.service_code,unit_ids:g.units,evidence_ordinals:[...g.ordinals]})),
   evidence_policy:{selected_chunks:evidence.length,total_chunks:chunks.length,selection_complete:valid},documents:report.data.map(r=>r.document_id)},model_conclusion:null,
 };
 return result;
}
