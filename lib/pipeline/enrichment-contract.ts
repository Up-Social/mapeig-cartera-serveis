import {FACT_NAMES,scopeFactsSchema,type ScopeFacts} from "../normative-matching";
import type {RoleFact} from "../scope-rules";
export type Enrichment = { scope_facts:ScopeFacts; title: string | null; provider_name: string | null; provider_nif: string | null; mechanism: string | null; award_date: string | null; amount: number | null; contracting_body: string | null; target_population: string | null; summary: string; confidence: number; evidence_ordinals: number[] };
export function enrichmentSchema() { return { type: "object", additionalProperties: false, required: ["scope_facts","title","provider_name","provider_nif","mechanism","award_date","amount","contracting_body","target_population","summary","confidence","evidence_ordinals"], properties: { scope_facts:scopeFactsSchema, title: nullableString(), provider_name: nullableString(), provider_nif: nullableString(), mechanism: nullableString(), award_date: nullableString(), amount: { anyOf: [{ type: "number" }, { type: "null" }] }, contracting_body: nullableString(), target_population: nullableString(), summary: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, evidence_ordinals: { type: "array", items: { type: "integer", minimum: 1 } } } }; }
function normalized(value:string){return value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('ca').replace(/[^a-z0-9]+/g,' ').trim();}
function supportedRoleValue(role:RoleFact|undefined,chunks:Array<{content:string}>){
 if(!role||role.state!=='known'||!role.value?.trim()||!Array.isArray(role.evidence_ordinals))return null;
 const expected=[...new Set(normalized(role.value).split(/\s+/).filter(token=>token.length>=2))];
 return expected.length&&role.evidence_ordinals.some(ordinal=>{const content=new Set(normalized(chunks[ordinal-1]?.content??'').split(/\s+/));return expected.every(token=>content.has(token));})?role.value.trim():null;
}
export function bindEnrichmentRoles(value:Enrichment,chunks:Array<{content:string}>):Enrichment{
 const scopeFacts={...value.scope_facts};
 for(const name of FACT_NAMES){
  const fact=scopeFacts[name];
  if(fact?.value!==null&&(!fact?.value?.trim()||!fact.evidence_ordinals?.length||fact.evidence_ordinals.some(ordinal=>!Number.isInteger(ordinal)||ordinal<1||ordinal>chunks.length))){
   scopeFacts[name]={value:null,evidence_ordinals:[]};
  }
 }
 const roles=scopeFacts.roles;
 const provider=supportedRoleValue(roles?.service_provider,chunks)??supportedRoleValue(roles?.economic_recipient,chunks);
 return {...value,award_date:normalizeAwardDate(value.award_date),scope_facts:scopeFacts,
  provider_name:provider,provider_nif:provider?value.provider_nif:null};
}
export function normalizeAwardDate(value:string|null):string|null{
 if(typeof value!=='string')return null;
 const date=value.trim();
 if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||date.startsWith('0000-'))return null;
 const parsed=new Date(`${date}T00:00:00.000Z`);
 return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:null;
}
function nullableString() { return { anyOf: [{ type: "string" }, { type: "null" }] }; }
export function sanitize(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([name, field]) => !name.startsWith("Fórmula ·") && !(typeof field === "string" && field.trim().startsWith("=")))); }
/** Structured extraction must use the final assistant message, never its preamble. */
export function extractOutputText(response: Record<string, unknown>): string {
 if (response.status === 'incomplete' || response.status === 'failed') throw new Error('OpenAI ha retornat una resposta incompleta');
 const output = Array.isArray(response.output) ? response.output : [];
 const messages = output.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && Array.isArray(item.content));
 const finals = messages.filter(item => item.phase === 'final_answer');
 const hasPhases = messages.some(item => item.phase != null);
 if (finals.length > 1) throw new Error('OpenAI ha retornat respostes finals ambigües');
 const selected = finals.length ? finals : hasPhases ? [] : messages;
 for (const item of selected) {
  if (item.status === 'incomplete') throw new Error('OpenAI ha retornat una resposta incompleta');
  const content = item.content as Array<Record<string, unknown>>;
  if (content.some(part => part.type === 'refusal')) throw new Error('OpenAI ha rebutjat la petició');
  const texts = content.filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text as string);
  if (texts.length) return texts.join('');
 }
 // SDK-only legacy envelopes can have output_text without output messages.
 if (!output.length && typeof response.output_text === 'string') return response.output_text;
 throw new Error('OpenAI no ha retornat text estructurat final');
}
