import {scopeFactsSchema,type ScopeFacts} from "../normative-matching";
import type {RoleFact} from "../scope-rules";
export type Enrichment = { scope_facts:ScopeFacts; title: string | null; provider_name: string | null; provider_nif: string | null; mechanism: string | null; award_date: string | null; amount: number | null; contracting_body: string | null; target_population: string | null; summary: string; confidence: number; evidence_ordinals: number[] };
export function enrichmentSchema() { return { type: "object", additionalProperties: false, required: ["scope_facts","title","provider_name","provider_nif","mechanism","award_date","amount","contracting_body","target_population","summary","confidence","evidence_ordinals"], properties: { scope_facts:scopeFactsSchema, title: nullableString(), provider_name: nullableString(), provider_nif: nullableString(), mechanism: nullableString(), award_date: nullableString(), amount: { anyOf: [{ type: "number" }, { type: "null" }] }, contracting_body: nullableString(), target_population: nullableString(), summary: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, evidence_ordinals: { type: "array", items: { type: "integer", minimum: 1 } } } }; }
function normalized(value:string){return value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('ca').replace(/[^a-z0-9]+/g,' ').trim();}
function supportedRoleValue(role:RoleFact|undefined,chunks:Array<{content:string}>){
 if(!role||role.state!=='known'||!role.value?.trim()||!Array.isArray(role.evidence_ordinals))return null;
 const expected=normalized(role.value);
 return role.evidence_ordinals.some(ordinal=>normalized(chunks[ordinal-1]?.content??'').includes(expected))?role.value.trim():null;
}
export function bindEnrichmentRoles(value:Enrichment,chunks:Array<{content:string}>):Enrichment{
 const roles=value.scope_facts?.roles;
 const provider=supportedRoleValue(roles?.service_provider,chunks)??supportedRoleValue(roles?.economic_recipient,chunks);
 return provider?{...value,provider_name:provider}:value;
}
function nullableString() { return { anyOf: [{ type: "string" }, { type: "null" }] }; }
export function sanitize(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([name, field]) => !name.startsWith("Fórmula ·") && !(typeof field === "string" && field.trim().startsWith("=")))); }
export function extractOutputText(response: Record<string, unknown>) { if (typeof response.output_text === "string") return response.output_text; const output = Array.isArray(response.output) ? response.output : []; for (const item of output) if (item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)) for (const content of (item as { content: Array<Record<string, unknown>> }).content) if (content.type === "output_text" && typeof content.text === "string") return content.text; throw new Error("OpenAI no ha retornat text estructurat"); }
