import {readPages} from '../read-pages';
import type {AnalysisOutput} from '../analysis-contract';
import type {OfficialService} from '../official-catalog';
import type {Context} from './context';
import {CloudFailure} from './errors';

export async function programAnalysis(c:Context,recordId:string,catalog:OfficialService[],chunks:Array<{content:string;source_document_id:string}>){
 const report=await c.db.from('concert_annex_reconciliations').select('*').eq('source_record_id',recordId).eq('extraction_version','program-columns-v2');
 if(report.error)throw new CloudFailure('internal');
 if(!report.data.length)return null;
 const lines={data:await readPages((from,to)=>c.db.from('record_units').select('id,document_id,page,reses_code,unit_key,observed_service_code,amount,storage_path,storage_sha256').eq('source_record_id',recordId).eq('extraction_origin','program-columns-v2').order('id').range(from,to))};
 const diagnostics:Array<Record<string,unknown>>=[];
 for(const r of report.data){
  if(!r.coverage?.complete)diagnostics.push({code:'incomplete_annex',message:`Annex parcial: ${r.coverage?.extractedRows??r.row_count} línies llegides de ${r.coverage?.candidateRows??'nombre desconegut'}.`,documentId:r.document_id,action:'enrich',rule:'annex_coverage'});
  if(!r.reconciled)diagnostics.push({code:'unreconciled_amount',message:'La suma de les línies encara no està conciliada amb el total documental, o hi ha canvis pendents sobre línies revisades.',documentId:r.document_id,action:'units',rule:'annex_reconciliation'});
 }
 const groups=new Map<string,{service:OfficialService;ordinals:Set<number>;units:string[]}>();
 for(const line of lines.data){
  const service=catalog.find(s=>s.service_code===line.observed_service_code&&s.benefit_type==='service');
  const code=line.reses_code??line.unit_key.match(/:([SC]\d{5}):\d+$/)?.[1];
  const ordinals=chunks.flatMap((chunk,index)=>chunk.source_document_id===line.document_id&&code&&chunk.content.includes(code)?[index+1]:[]);
  if(!service||!ordinals.length||!line.storage_path){diagnostics.push({code:'unresolved_line',message:`Línia ${code??line.id}: ${!service?'la tipologia impresa no identifica un codi acreditat':!line.storage_path?'falta la còpia arxivada':'falta el fragment documental de la línia'}.`,documentId:line.document_id,page:line.page,unitId:line.id,action:'units',rule:'line_evidence'});continue;}
  const group=groups.get(service.service_code)??{service,ordinals:new Set<number>(),units:[]};
  ordinals.forEach(n=>group.ordinals.add(n));group.units.push(line.id);groups.set(service.service_code,group);
 }
 const evidence=[...new Set([...groups.values()].flatMap(g=>[...g.ordinals]))];
 if(!evidence.length)return null;
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
   evidence_ordinals:[...g.ordinals],evidence_explanation:'Tipologia del servei i destinataris impresos a les línies de l’annex.'})):[],
  rule_audit:{version:'concert-program-lines-v2',diagnostics,line_count:lines.data.length,groups:[...groups.values()].map(g=>({code:g.service.service_code,unit_ids:g.units,evidence_ordinals:[...g.ordinals]})),
   evidence_policy:{selected_chunks:evidence.length,total_chunks:chunks.length,selection_complete:valid},documents:report.data.map(r=>r.document_id)},model_conclusion:null,
 };
 return result;
}
