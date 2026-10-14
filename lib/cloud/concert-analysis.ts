import type {AnalysisOutput} from '../analysis-contract';
import type {OfficialService} from '../official-catalog';
import type {Context} from './context';

type Evidence={content:string};
export function annexCandidateOrdinals(lines:Array<{observed_service_code:string|null;reses_code:string|null}>,
 codes:string[],chunks:Evidence[]):number[]{
 return codes.map(code=>{
  const matching=lines.filter(row=>row.observed_service_code===code);
  return chunks.findIndex(chunk=>matching.some(row=>row.reses_code&&chunk.content.includes(row.reses_code)&&
   (chunk.content.includes(code)||chunk.content.includes(code.slice(0,-1)))))+1;
 });
}
export async function reconciledConcertAnalysis(c:Context,job:{id:string;source_record_id:string},
 eligible:OfficialService[],chunks:Evidence[]):Promise<(AnalysisOutput&{rule_audit:Record<string,unknown>;model_conclusion:null})|null>{
 const reports=await c.db.from('concert_annex_reconciliations').select('document_id,document_sha256,annex,row_count,sum_cents,declared_cents,reconciled')
  .eq('source_record_id',job.source_record_id).eq('reconciled',true);
 if(reports.error||reports.data.length!==1)return null;
 const report=reports.data[0];
 const lines=await c.db.from('record_units').select('observed_service_code,reses_code,act_type,amount,storage_path,storage_sha256')
  .eq('source_record_id',job.source_record_id).eq('document_id',report.document_id)
  .like('unit_key',`official-annex:${report.document_sha256}:${report.annex}:%`);
 if(lines.error||lines.data.length!==report.row_count||lines.data.some(row=>row.act_type!=='award'||
  row.amount===null||!row.storage_path||row.storage_sha256!==report.document_sha256))return null;
 if(Math.round(lines.data.reduce((sum,row)=>sum+Number(row.amount)*100,0))!==report.sum_cents||report.sum_cents!==report.declared_cents)return null;
 const codes=[...new Set(lines.data.map(row=>row.observed_service_code))];
 if(codes.length<1||codes.length>3||codes.some(code=>!code))return null;
 const services=codes.map(code=>eligible.find(service=>service.service_code===code&&service.benefit_type==='service'));
 if(services.some(service=>!service))return null;
 // Some official tables print the last digit of a code in the next column.
 // Cite a selected source fragment containing both its RESES row and the
 // printed code prefix; the completed code is the row parser's observation.
 const ordinals=annexCandidateOrdinals(lines.data,codes as string[],chunks);
 if(ordinals.some(ordinal=>ordinal<1))return null;
 const populations=[...new Set(services.map(service=>service!.service_name.match(/per a (gent gran|persones amb [^,;.]+)/i)?.[1]).filter(Boolean))];
 if(!populations.length)return null;
 const evidence_ordinals=[...new Set(ordinals)];
 return {
  classification:'in_portfolio',reasons:[],
  explanation:`L’annex econòmic oficial conté ${report.row_count} línies amb codis de la Cartera i un total de ${(report.sum_cents/100).toFixed(2)} €. La suma coincideix amb l’import de la resolució. Cal revisar les entitats i aprovar el conjunt abans d’exportar-lo.`,
  service_description:services.map(service=>service!.service_name).join(' · '),
  target_population:populations.join(' i '),evidence_ordinals,population_verified:true,social_service_verified:true,
  candidates:services.map((service,index)=>({code:service!.service_code,score:1,
   rationale:`Codi ${service!.service_code} imprès a les línies de l’annex econòmic oficial i contrastat amb el catàleg vigent; el total de l’annex coincideix amb el resolc.`,
   evidence_ordinals:[ordinals[index]],evidence_explanation:`Codi explícit i import individual a l’annex econòmic de la resolució.`,
   population_compatible:true,legal_reference:service!.legal_reference})),
  rule_audit:{version:'concert-reconciled-annex-v1',document_id:report.document_id,document_sha256:report.document_sha256,
   annex:report.annex,row_count:report.row_count,sum_cents:report.sum_cents,declared_cents:report.declared_cents},
  model_conclusion:null,
 };
}
