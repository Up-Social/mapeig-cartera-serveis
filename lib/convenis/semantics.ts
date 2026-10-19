import type {ConveniAnalysis} from './contract';
import {ConveniValidationError} from './diagnostics';
export const CONVENI_SEMANTIC_VERSION='conveni-social-assessment-v1';
export type ConveniService={service_code:string;service_name:string};
export const serviceReference=(s:ConveniService)=>`${s.service_code} · ${s.service_name}`;
/** A single catalog choice binds code and official name. Never infer a code
 * from free prose or replace a previous model/human classification. */
export function resolveConveniServices(input:ConveniAnalysis,services:ConveniService[]):ConveniAnalysis {
 const byReference=new Map(services.map(s=>[serviceReference(s),s]));
 return {...input,units:input.units.map((unit,index)=>{
  const {service_ref:ref,...data}=unit as typeof unit&{service_ref?:string|null};
  if(ref!==null&&(typeof ref!=='string'||!byReference.has(ref)))throw new ConveniValidationError({code:'CONVENI_UNKNOWN_SERVICE_REFERENCE',message:'Selecció de servei desconeguda: cal codi i nom oficial del catàleg.',field:'service_ref',index,recipient:unit.recipient});
  const service=ref===null?null:byReference.get(ref!)!;
  return {...data,service_code:service?.service_code??null,service_name:service?.service_name??null,semantic_version:CONVENI_SEMANTIC_VERSION};
 })};
}
