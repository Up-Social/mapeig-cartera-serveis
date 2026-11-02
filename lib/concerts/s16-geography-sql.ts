import {compareS16Sources,S16_DOCUMENT_SHA,S16_SOURCE_URL,sha} from './s16-geography-dry-run';

const RECORD='cf3e157d-d29b-4c01-96ab-42f6e4a04e18';
const DOCUMENT='0566ccec-3205-4871-8001-3abee31fd070';
const EXPECTED=[{id:'45fd04f2-500a-42c6-a0ac-89037b0cd839',service:'EVAMI'},
 {id:'f17be3d5-98dc-4ca7-8645-e4f1a007e82f',service:'ETCA'}] as const;
type Preflight={mode:string;project:string;record:string;document:string;documentSha256:string;sourceUrl:string;sourceSha256:string;proposals:Array<{unit:string;service:string;economicSourceFingerprint:string}>};

// SQL strings are encoded as data; the generated file contains no arbitrary
// SQL from remote text and must still be reviewed and explicitly authorized.
const sqlText=(s:string)=>`convert_from(decode('${Buffer.from(s,'utf8').toString('hex')}','hex'),'UTF8')`;
export function prepareS16GeographySql(preflight:Preflight,local:Uint8Array,live:Uint8Array,capturedAt:string):string{
 if(preflight.mode!=='dry-run-read-only'||preflight.project!=='vvzxlevbfjvzygorbpxn'||preflight.record!==RECORD||preflight.document!==DOCUMENT||preflight.documentSha256!==S16_DOCUMENT_SHA||preflight.sourceUrl!==S16_SOURCE_URL||!/^[a-f0-9]{64}$/.test(preflight.sourceSha256)||!Number.isFinite(Date.parse(capturedAt))||new Date(capturedAt).toISOString()!==capturedAt)throw Error('PREFLIGHT_CHANGED');
 // The preflight and this preparation use separate HTTP responses; dynamic
 // page bytes may differ. Revalidate the pinned local copy and both material
 // excerpts against this response, then hash the bytes actually embedded.
 const source=compareS16Sources(local,live);
 if(!Array.isArray(preflight.proposals)||preflight.proposals.length!==2)throw Error('PROPOSALS_CHANGED');
 const items=EXPECTED.map(want=>{
  const found=preflight.proposals.filter(x=>x.unit===want.id&&x.service===want.service);
  if(found.length!==1||!/^[a-f0-9]{32}$/.test(found[0].economicSourceFingerprint))throw Error('UNIT_FINGERPRINT_MISSING');
  return {...want,oldFingerprint:found[0].economicSourceFingerprint,quote:source.quotes[want.service]};
 });
 const data=(s:string)=>sqlText(s);
 const calls=items.map(item=>`
 select * into strict u from public.record_units where id='${item.id}'::uuid and source_record_id='${RECORD}'::uuid;
 if md5(to_jsonb(u)::text) is distinct from '${item.oldFingerprint}' or u.document_id is distinct from '${DOCUMENT}'::uuid or u.storage_sha256 is distinct from '${S16_DOCUMENT_SHA}' then raise exception 'S1_6_UNIT_CHANGED'; end if;
 fingerprint_:=md5(jsonb_build_array(u.unit_key,u.document_id,u.storage_sha256,u.page,u.provider_nif,u.reses_code,u.observed_service_code,u.amount,u.quantity_delta,u.evidence_quote)::text);
 perform public.propose_concert_supplemental_geography(u.id,fingerprint_,'${S16_DOCUMENT_SHA}',${data(S16_SOURCE_URL)},'${capturedAt}'::timestamptz,
  decode('${Buffer.from(live).toString('hex')}','hex'),${data(source.sourceText)},'${sha(live)}','${sha(source.sourceText)}',${data(item.quote)},'9409','${item.service}',
  ${data(source.reference.municipality)},${data(source.reference.county)},${data(source.reference.province)},${data(JSON.stringify(source.reference))}::jsonb);`).join('\n');
 return `-- CANDIDATO NO EJECUTADO: requiere migración 20261102190000 y autorización específica.\n-- Dos propuestas pendientes; nunca confirma ubicación económica o financiador.\nbegin;\ndo $$\ndeclare u public.record_units; fingerprint_ text;\nbegin\n perform 1 from public.record_units where id in ('${EXPECTED[0].id}'::uuid,'${EXPECTED[1].id}'::uuid) order by id for update;\n ${calls}\nend $$;\ncommit;\n`;
}
