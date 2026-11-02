import {extractOutputText} from '../pipeline/enrichment-contract';

export type RetainedConveniProposal={recipient:string;period:string;classification:string;reason:string|null;explanation:string;description:string;population:string;amountCents:number|null;amountState:string|null};
const classifications:Record<string,string>={in_portfolio:'Servei de cartera proposat',out_of_portfolio:'Fora de cartera proposat',discarded:'Descart proposat',insufficient_evidence:'Evidència insuficient proposada'};
const states:Record<string,string>={planned:'Previst',conditional:'Condicionat',confirmed:'Confirmat segons la resposta'};
function field(value:unknown,max:number,required=true):string|null {
 if(value==null&&!required)return null;
 if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw Error('INVALID_RECEIPT');
 return value;
}
/** Presentation only: never interpret provider output as validated evidence or a decision. */
export function retainedConveniProposals(value:unknown):RetainedConveniProposal[]|null {
 try {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const result=value as Record<string,unknown>;
  if(result.status!=='received'||!result.response||typeof result.response!=='object'||Array.isArray(result.response))return null;
  // Do not assume legacy or partially streamed payloads are completed.
  if((result.response as Record<string,unknown>).status!=='completed')return null;
  const text=extractOutputText(result.response as Record<string,unknown>);
  if(text.length>200_000)return null;
  const analysis=JSON.parse(text) as Record<string,unknown>;
  if(!Array.isArray(analysis?.units)||analysis.units.length<1||analysis.units.length>100)return null;
  return analysis.units.map((item:unknown)=>{
   if(!item||typeof item!=='object'||Array.isArray(item))throw Error('INVALID_RECEIPT');
   const unit=item as Record<string,unknown>;
   if(typeof unit.classification!=='string'||!Object.hasOwn(classifications,unit.classification))throw Error('INVALID_RECEIPT');
   if(unit.amount_cents!=null&&(!Number.isSafeInteger(unit.amount_cents)||Number(unit.amount_cents)<0))throw Error('INVALID_RECEIPT');
   if(unit.amount_state!=null&&(typeof unit.amount_state!=='string'||!Object.hasOwn(states,unit.amount_state)))throw Error('INVALID_RECEIPT');
   return {recipient:field(unit.recipient,500)!,period:field(unit.period,200)!,classification:classifications[unit.classification],
    reason:field(unit.reason,1000,false),explanation:field(unit.explanation,3000)!,description:field(unit.description,2000)!,population:field(unit.population,1000)!,
    amountCents:unit.amount_cents==null?null:unit.amount_cents as number,amountState:unit.amount_state==null?null:states[unit.amount_state as string]};
  });
 }catch{return null;}
}
