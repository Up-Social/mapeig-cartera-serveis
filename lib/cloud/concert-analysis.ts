import type {AnalysisOutput} from '../analysis-contract';
import type {OfficialService} from '../official-catalog';
import type {Context} from './context';
import {safeAnnexSum,storedAmountCents} from '../concerts/annex-extraction';

type Evidence={content:string;source_document_id?:string};
/** Each printed code must provide a recognisable population; one populated
 * service cannot silently stand in for the remaining services. */
export function concertPopulations(services:Array<Pick<OfficialService,'service_name'>>):string[]|null{
 const populations=services.map(service=>service.service_name.match(/per a (gent gran|persones amb [^,;.]+)/i)?.[1]?.trim());
 return populations.every(Boolean)?[...new Set(populations as string[])]:null;
}
export function annexCandidateOrdinals(lines:Array<{observed_service_code:string|null;reses_code:string|null;evidence_quote?:string|null}>,
 codes:string[],chunks:Evidence[],documentId?:string):number[]{
 return codes.map(code=>{
  const matching=lines.filter(row=>row.observed_service_code===code);
  const last=code.lastIndexOf('.');
  const prefix=last>0?code.slice(0,last):code,suffix=last>0?code.slice(last):'';
  const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const complete=new RegExp(`(^|[^0-9.])${escape(code)}(?![0-9]|\\.[0-9])`,'g');
  const split=suffix?new RegExp(`(^|[^0-9.])${escape(prefix)}(?:\\.(?=[^0-9.])[\\s\\S]{0,500}?(?<![0-9.])${escape(suffix.slice(1))}|(?=[^0-9.])[\\s\\S]{0,500}?${escape(suffix)})(?![0-9]|\\.[0-9])`,'g'):null;
  return chunks.findIndex(chunk=>(!documentId||chunk.source_document_id===documentId)&&matching.some(row=>{
   if(!row.reses_code||!chunk.content.includes(row.reses_code))return false;
   const content=chunk.content.replace(/\s+/g,' ');
   const quote=row.evidence_quote?.replace(/\s+/g,' ').trim()??content;
   for(const pattern of [complete,split]){
    if(!pattern)continue;
    pattern.lastIndex=0;
    for(const match of quote.matchAll(pattern)){
     const start=match.index??0,end=start+match[0].length;
     const registry=quote.indexOf(row.reses_code,end);
     if(registry>=0&&registry-end<=500&&content.includes(quote.slice(start,registry+row.reses_code.length).trim()))return true;
     // Some annexes print RESES before the code. Require an explicitly
     // source-backed row quote and the nearest preceding identifier; never
     // bind a code across another service's RESES.
     if(row.evidence_quote){
      const before=quote.lastIndexOf(row.reses_code,start);
      if(before>=0&&start-(before+row.reses_code.length)<=160&&!/\bS\d{5}\b/.test(quote.slice(before+row.reses_code.length,start))&&content.includes(quote.slice(before,end).trim()))return true;
     }
    }
   }
   return false;
  }))+1;
 });
}
export async function reconciledConcertAnalysis(c:Context,job:{id:string;source_record_id:string},
 eligible:OfficialService[],chunks:Evidence[]):Promise<(AnalysisOutput&{rule_audit:Record<string,unknown>;model_conclusion:null})|null>{
 const reports=await c.db.from('concert_annex_reconciliations').select('document_id,document_sha256,annex,row_count,sum_cents,declared_cents,reconciled,coverage')
  .eq('source_record_id',job.source_record_id).eq('reconciled',true);
 if(reports.error||reports.data.length!==1)return null;
 const report=reports.data[0];
 const lines=await c.db.from('record_units').select('observed_service_code,provider_nif,reses_code,evidence_quote,act_type,amount,storage_path,storage_sha256')
  .eq('source_record_id',job.source_record_id).eq('document_id',report.document_id)
  .like('unit_key',`official-annex:${report.document_sha256}:${report.annex}:%`);
 if(lines.error||lines.data.length!==report.row_count||lines.data.some(row=>row.act_type!=='award'||
  row.amount===null||!row.evidence_quote||!row.storage_path||row.storage_sha256!==report.document_sha256))return null;
 if(lines.data.some(row=>!row.provider_nif||!row.evidence_quote?.includes(row.provider_nif))){
  if(!chunks.length)return null;
  const index=chunks.findIndex(chunk=>chunk.source_document_id===report.document_id);
  return {classification:'insufficient_evidence',reasons:[],explanation:'Hi ha línies de l’annex amb identitat del prestador pendent. Cal contrastar-les abans de validar el conjunt.',service_description:'',target_population:'',evidence_ordinals:[index<0?1:index+1],population_verified:false,social_service_verified:false,candidates:[],rule_audit:{version:'concert-reconciled-annex-v1',diagnostics:[{code:'missing_provider_identity',message:'Almenys una línia no té NIF acreditat a la seva evidència.',action:'units',rule:'line_identity'}]},model_conclusion:null};
 }
 const amounts=lines.data.map(row=>storedAmountCents(row.amount));
 if(amounts.some(amount=>amount===null)||safeAnnexSum(amounts)!==report.sum_cents||report.sum_cents!==report.declared_cents)return null;
 const codes=[...new Set(lines.data.map(row=>row.observed_service_code))];
 if(codes.length<1||codes.length>1_000||codes.some(code=>!code))return null;
 const services=codes.map(code=>eligible.find(service=>service.service_code===code&&service.benefit_type==='service'));
 if(services.some(service=>!service))return null;
 // Some official tables print the last digit of a code in the next column.
 // Cite a selected source fragment containing both its RESES row and the
 // printed code prefix; the completed code is the row parser's observation.
 const ordinals=annexCandidateOrdinals(lines.data,codes as string[],chunks,report.document_id);
 if(ordinals.some(ordinal=>ordinal<1))return null;
 const populations=concertPopulations(services as OfficialService[]);
 if(!populations?.length)return null;
 const evidence_ordinals=[...new Set(ordinals)];
 const maximum=report.coverage?.declared_amount_kind==='maximum';
 return {
  classification:'in_portfolio',reasons:[],
  explanation:`L’annex econòmic oficial conté ${report.row_count} línies amb codis de la Cartera i un total de ${(report.sum_cents/100).toFixed(2)} €. La suma coincideix amb ${maximum?'l’import màxim declarat':'l’import'} de la resolució. Cal revisar les entitats i aprovar el conjunt abans d’exportar-lo.`,
  service_description:services.map(service=>service!.service_name).join(' · '),
  target_population:populations.join(' i '),evidence_ordinals,population_verified:true,social_service_verified:true,
  candidates:services.map((service,index)=>({code:service!.service_code,score:1,
   rationale:`Codi ${service!.service_code} imprès a les línies de l’annex econòmic oficial i contrastat amb el catàleg vigent; el total de l’annex coincideix amb el resolc.`,
   evidence_ordinals:[ordinals[index]],evidence_explanation:`Codi explícit i import individual a l’annex econòmic de la resolució.`,
   population_compatible:true,legal_reference:service!.legal_reference})),
  rule_audit:{version:'concert-reconciled-annex-v1',document_id:report.document_id,document_sha256:report.document_sha256,
   annex:report.annex,row_count:report.row_count,sum_cents:report.sum_cents,declared_cents:report.declared_cents,declared_amount_kind:maximum?'maximum':null},
  model_conclusion:null,
 };
}
