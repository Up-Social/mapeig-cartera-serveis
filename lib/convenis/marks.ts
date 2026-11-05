import {normalizeConveni,type Payload} from './contract';

/** Deterministic record marks read from the Excel row. They complement the
 * model's proposal (OR) and always keep where each mark comes from. */
const GRANT=[
 /\bsubvenci[oó]\s+(nominativa|directa|excepcional)/,
 /\batorgament\s+d[’'e]\s*(una\s+)?subvenci[oó]/,
 /\bregulador(a)?\s+de\s+(la|una)\s+subvenci[oó]/,
 /\bcanalitzar\s+(la|una)\s+subvenci[oó]/,
 /\bconcessi[oó]\s+(directa\s+)?d[’'e]\s*(una\s+)?subvenci[oó]/,
];
const fold=(value:unknown)=>typeof value==='string'?value.toLowerCase().replace(/\s+/g,' '):'';

export type GrantMark={value:boolean;sources:Array<'excel'|'ia'>;field:'Títol conveni'|'Objecte'|null};
export function conveniGrantMark(payload:Payload,modelValue:boolean|null|undefined):GrantMark{
 const field=GRANT.some(re=>re.test(fold(payload['Títol conveni'])))?'Títol conveni':GRANT.some(re=>re.test(fold(payload['Objecte'])))?'Objecte':null;
 const sources:GrantMark['sources']=[...(field?['excel' as const]:[]),...(modelValue?['ia' as const]:[])];
 return {value:sources.length>0,sources,field};
}
export const conveniInstrumentsGrant=(payload:Payload,modelValue:boolean|null|undefined)=>conveniGrantMark(payload,modelValue).value;

export type RelatedConveni={number:string;id:string|null;title:string|null;signed:string|null;relation:'earlier'|'later'|'unknown'};
type RelatedRow={id:string;source_record_id:string;title:string;source_payload:Payload};
const signedAt=(payload:Payload)=>{const value=payload['Data signatura'];return typeof value==='string'&&value.trim()?value.trim():null;};
const sortable=(value:string|null)=>{if(!value)return null;const iso=/^(\d{4})-(\d{2})-(\d{2})/.exec(value);if(iso)return value.slice(0,10);const dmy=/^(\d{2})\/(\d{2})\/(\d{4})/.exec(value);return dmy?`${dmy[3]}-${dmy[2]}-${dmy[1]}`:null;};
/** Resolves «Convenis relacionats» against imported records by definitive
 * number. It never infers renewal or amendment: only the signature order. */
export function resolveRelatedConvenis(payload:Payload,rows:RelatedRow[]):RelatedConveni[]{
 const own=sortable(signedAt(payload));
 return normalizeConveni(payload).related.map(number=>{
  const row=rows.find(r=>r.source_record_id===number||fold(r.source_payload['Número conveni definitiu'])===fold(number));
  if(!row)return {number,id:null,title:null,signed:null,relation:'unknown' as const};
  const signed=signedAt(row.source_payload);const other=sortable(signed);
  return {number,id:row.id,title:row.title,signed,relation:own&&other&&own!==other?(other<own?'earlier' as const:'later' as const):'unknown' as const};
 });
}
