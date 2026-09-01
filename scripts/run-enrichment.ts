import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const recordId = option("--source-record-id");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MATCHING_MODEL;
if (!recordId || !url || !key || !openaiKey || !model) throw new Error("Falta el registre o la configuració de Supabase/OpenAI");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as never } });
type Enrichment = { title: string | null; provider_name: string | null; provider_nif: string | null; mechanism: string | null; award_date: string | null; amount: number | null; contracting_body: string | null; target_population: string | null; summary: string; confidence: number; evidence_ordinals: number[] };

async function main() {
  try {
    const { data: record, error: recordError } = await supabase.from("source_records").select("id,source_dataset,source_record_id,mechanism,title,provider_name,amount,source_payload,source_documents!inner(id,status)").eq("id", recordId).eq("source_documents.status", "fetched").single();
    if (recordError) throw recordError;
    const documentIds = record.source_documents.map((document: { id: string }) => document.id);
    const { data: chunks, error: chunksError } = await supabase.from("evidence_chunks").select("id,ordinal,content").in("source_document_id", documentIds).order("ordinal").limit(12);
    if (chunksError) throw chunksError;
    if (!chunks?.length) throw new Error("No hi ha fragments oficials preparats");
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({
      model,
      instructions: "Extreu camps estructurats exclusivament dels fragments dels documents oficials. Usa null quan un camp no hi consti, no completis dades per intuïció i cita els ordinals que sustenten l'extracció. No facis cap matching ni proposis serveis de la Cartera. Respon en català.",
      input: `REGISTRE ORIGINAL (només context)\n${JSON.stringify({ dataset: record.source_dataset, id: record.source_record_id, mechanism: record.mechanism, title: record.title, provider: record.provider_name, amount: record.amount, original: sanitize(record.source_payload) })}\n\nFRAGMENTS OFICIALS\n${chunks.map((chunk, index) => `[${index + 1}] ${chunk.content}`).join("\n\n")}`,
      text: { format: { type: "json_schema", name: "official_enrichment", strict: true, schema: enrichmentSchema() } }, max_output_tokens: 1000,
    }) });
    const raw = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${JSON.stringify(raw)}`);
    const enrichment = JSON.parse(extractOutputText(raw)) as Enrichment;
    const awardDate = enrichment.award_date && /^\d{4}-\d{2}-\d{2}$/.test(enrichment.award_date) ? enrichment.award_date : null;
    const { data: stored, error: storedError } = await supabase.from("record_enrichments").upsert({ source_record_id: record.id, extracted_title: enrichment.title, provider_name: enrichment.provider_name, provider_nif: enrichment.provider_nif, mechanism: enrichment.mechanism, award_date: awardDate, amount: enrichment.amount, contracting_body: enrichment.contracting_body, target_population: enrichment.target_population, summary: enrichment.summary, confidence: enrichment.confidence, engine: "openai-responses-enrichment", engine_version: model, updated_at: new Date().toISOString() }, { onConflict: "source_record_id" }).select("id").single();
    if (storedError) throw storedError;
    await supabase.from("record_enrichment_evidence").delete().eq("enrichment_id", stored.id);
    const evidence = [...new Set(enrichment.evidence_ordinals)].map((ordinal) => chunks[ordinal - 1]).filter(Boolean);
    if (evidence.length) { const { error } = await supabase.from("record_enrichment_evidence").insert(evidence.map((chunk) => ({ enrichment_id: stored.id, evidence_chunk_id: chunk.id }))); if (error) throw error; }
    await supabase.from("source_records").update({ enrichment_status: "completed", enrichment_error: null, updated_at: new Date().toISOString() }).eq("id", record.id);
    console.log(`${record.source_record_id}: contrast oficial completat`);
  } catch (error) {
    const message = formatError(error);
    await supabase.from("source_records").update({ enrichment_status: "error", enrichment_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", recordId);
    throw new Error(message);
  }
}

function enrichmentSchema() { return { type: "object", additionalProperties: false, required: ["title","provider_name","provider_nif","mechanism","award_date","amount","contracting_body","target_population","summary","confidence","evidence_ordinals"], properties: { title: nullableString(), provider_name: nullableString(), provider_nif: nullableString(), mechanism: nullableString(), award_date: nullableString(), amount: { anyOf: [{ type: "number" }, { type: "null" }] }, contracting_body: nullableString(), target_population: nullableString(), summary: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, evidence_ordinals: { type: "array", items: { type: "integer", minimum: 1 } } } }; }
function nullableString() { return { anyOf: [{ type: "string" }, { type: "null" }] }; }
function sanitize(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([name, field]) => !name.startsWith("Fórmula ·") && !(typeof field === "string" && field.trim().startsWith("=")))); }
function extractOutputText(response: Record<string, unknown>) { if (typeof response.output_text === "string") return response.output_text; const output = Array.isArray(response.output) ? response.output : []; for (const item of output) if (item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)) for (const content of (item as { content: Array<Record<string, unknown>> }).content) if (content.type === "output_text" && typeof content.text === "string") return content.text; throw new Error("OpenAI no ha retornat text estructurat"); }
function formatError(error: unknown) { if (error instanceof Error) return error.message; if (error && typeof error === "object") { const value = error as Record<string, unknown>; return [value.message,value.details,value.hint,value.code].filter(Boolean).join(" · ") || JSON.stringify(value); } return String(error); }
function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
void main().catch((error: unknown) => { console.error("Contrast fallit:", formatError(error)); process.exitCode = 1; });
