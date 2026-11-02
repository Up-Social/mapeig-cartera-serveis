import {isUuid} from '../uuid';

type Candidate={jobId:string;unitId:string;receiptId:string;linkId:string;reviewer:string;previousId?:string|null};
type Recovery={provisionId:string;reviewer:string;note:string;exports:Array<{eventId:string;createdAt:string;sha256:string}>;current?:boolean};
type Preview={candidate:Candidate|null;recovery:Recovery|null;independent:boolean;pendingReason:string|null};
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&isUuid(v);
/** Accept only the endpoint's documented legacy or independent response.
 * Unknown/malformed data cannot re-enable a previously displayed decision. */
export function parseEconomicPreview(value:unknown,jobId:string,unitId:string):Preview {
 const invalid=()=>{throw Error('No es pot verificar la resposta de preparació econòmica. Torna-la a consultar.');};
 if(!object(value)||!Object.hasOwn(value,'candidate')||!Object.hasOwn(value,'recovery')||(value.independent!==undefined&&typeof value.independent!=='boolean'))return invalid();
 const independent=value.independent===true;
 if(independent&&(!Object.hasOwn(value,'pendingReason')||(value.pendingReason!==null&&typeof value.pendingReason!=='string')))return invalid();
 const c=value.candidate;
 if(c!==null&&(!object(c)||c.jobId!==jobId||c.unitId!==unitId||!uuid(c.receiptId)||!uuid(c.linkId)||typeof c.reviewer!=='string'||c.reviewer.trim().length<3||(independent&&(!Object.hasOwn(c,'previousId')||(c.previousId!==null&&!uuid(c.previousId))))))return invalid();
 const r=value.recovery;
 if(r!==null&&(!object(r)||!uuid(r.provisionId)||typeof r.reviewer!=='string'||typeof r.note!=='string'||!Array.isArray(r.exports)||(independent&&typeof r.current!=='boolean')||r.exports.some((x:unknown)=>!object(x)||!uuid(x.eventId)||typeof x.createdAt!=='string'||!Number.isFinite(Date.parse(x.createdAt))||typeof x.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(x.sha256))))return invalid();
 if(!independent&&c!==null&&r!==null)return invalid();
 return {candidate:c as Candidate|null,recovery:r as Recovery|null,independent,pendingReason:independent?value.pendingReason as string|null:null};
}
