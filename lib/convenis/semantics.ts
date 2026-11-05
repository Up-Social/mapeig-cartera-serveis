import type {ConveniAnalysis} from './contract';
export const CONVENI_SEMANTIC_VERSION='conveni-social-assessment-v2';
export type ConveniService={service_code:string;service_name:string};
export const serviceReference=(s:ConveniService)=>`${s.service_code} · ${s.service_name}`;
/** A single catalog choice binds code and official name. Never infer a code
 * from free prose or replace a previous model/human classification. */
export function resolveConveniServices(input:ConveniAnalysis,services:ConveniService[]):ConveniAnalysis {
 const byReference=new Map(services.map(s=>[serviceReference(s),s]));
 return {...input,units:input.units.map(unit=>{
  const {service_ref:ref,...data}=unit as typeof unit&{service_ref?:string|null};
  // An unknown reference never becomes a code: it is kept apart so that
  // validation reports it and keeps the unit as a proposal to review.
  const service=typeof ref==='string'?byReference.get(ref)??null:null;
  const unresolved=ref!==null&&!service?{unresolved_service_ref:typeof ref==='string'?ref.slice(0,200):''}:{};
  return {...data,...unresolved,service_code:service?.service_code??null,service_name:service?.service_name??null,semantic_version:CONVENI_SEMANTIC_VERSION};
 })};
}
