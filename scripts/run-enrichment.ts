import {readEvidenceChunks} from '../lib/pipeline/evidence-reader';
import {ROLE_INSTRUCTIONS} from '../lib/scope-rules';
import {journaledProviderRequest} from '../lib/provider-journal';
import {validateScopeFacts} from '../lib/normative-matching';
import {bindEnrichmentRoles,enrichmentSchema,sanitize,extractOutputText,type Enrichment} from '../lib/pipeline/enrichment-contract';
import {isEligibleEvidence} from '../lib/evidence-eligibility';
import {selectEvidenceWindow} from '../lib/cloud/evidence-window';
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const recordId = option("--source-record-id");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MATCHING_MODEL;
if (!recordId || !url || !key || !openaiKey || !model) throw new Error("Falta el registre o la configuració de Supabase/OpenAI");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as never } });


async function main() {
  try {
    const { data: record, error: recordError } = await supabase.from("source_records").select("id,source_dataset,source_record_id,mechanism,title,provider_name,amount,source_payload,source_documents!inner(id,status,text_length,extraction_method,quality_flags)").eq("id", recordId).eq("source_documents.status", "fetched").single();
    if (recordError) throw recordError;
    const documents = new Map(record.source_documents.map((document: { id: string; text_length:number|null; extraction_method:string|null; quality_flags:string[]|null }) => [document.id, document]));
    const evidence = await readEvidenceChunks(supabase, [...documents.keys()]);
    const chunks=selectEvidenceWindow((evidence??[]).filter(chunk=>{
      const document=documents.get(chunk.source_document_id);
      return isEligibleEvidence({content:chunk.content,textLength:document?.text_length,extractionMethod:document?.extraction_method,qualityFlags:document?.quality_flags});
    }));
    if (!chunks.length) {
      const saved=await supabase.from('record_enrichments').upsert({source_record_id:record.id,extracted_title:null,provider_name:null,provider_nif:null,mechanism:null,award_date:null,amount:null,contracting_body:null,target_population:null,scope_facts:null,summary:'No hi ha evidència oficial llegible i substantiva.',confidence:0,engine:'deterministic-evidence-policy',engine_version:'substantive-evidence-v2'},{onConflict:'source_record_id'}).select('id').single();
      if(saved.error)throw saved.error;
      const cleared=await supabase.from('record_enrichment_evidence').delete().eq('enrichment_id',saved.data.id);if(cleared.error)throw cleared.error;
      const updated=await supabase.from('source_records').update({enrichment_status:'completed',enrichment_error:null}).eq('id',record.id);if(updated.error)throw updated.error;return;
    }
    let jobQuery=supabase.from('pipeline_jobs').select('id').eq('source_record_id',record.id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1);
    if(process.env.WORKFLOW_JOB_ID)jobQuery=jobQuery.eq('id',process.env.WORKFLOW_JOB_ID);
    const job=await jobQuery.single();if(job.error)throw job.error;
    const raw=await journaledProviderRequest(supabase,job.data.id,'enrichment',{
      model,
      instructions: ROLE_INSTRUCTIONS+" Extreu camps estructurats exclusivament dels fragments dels documents oficials. Usa null quan un camp no hi consti, no completis dades per intuïció i cita els ordinals que sustenten l'extracció. Separa scope_facts: financed_object (objecte finançat), funding_recipient (receptor dels diners), final_recipient (destinatari final) i administrative_role (funció de l’acte); cada valor ha de citar els seus fragments, o ser null. No facis cap matching ni proposis serveis de la Cartera. Respon en català.",
      input: `REGISTRE ORIGINAL (només context)\n${JSON.stringify({ dataset: record.source_dataset, id: record.source_record_id, mechanism: record.mechanism, title: record.title, provider: record.provider_name, amount: record.amount, original: sanitize(record.source_payload) })}\n\nFRAGMENTS OFICIALS\n${chunks.map((chunk, index) => `[${index + 1}] ${chunk.content}`).join("\n\n")}`,
      text: { format: { type: "json_schema", name: "official_enrichment", strict: true, schema: enrichmentSchema() } }, max_output_tokens: 2400,
    });
    const enrichment = bindEnrichmentRoles(JSON.parse(extractOutputText(raw)) as Enrichment,chunks);
    validateScopeFacts(enrichment.scope_facts,chunks.length);
    const awardDate = enrichment.award_date && /^\d{4}-\d{2}-\d{2}$/.test(enrichment.award_date) ? enrichment.award_date : null;
    const { data: stored, error: storedError } = await supabase.from("record_enrichments").upsert({ source_record_id: record.id, extracted_title: enrichment.title, provider_name: enrichment.provider_name, provider_nif: enrichment.provider_nif, mechanism: enrichment.mechanism, award_date: awardDate, amount: enrichment.amount, contracting_body: enrichment.contracting_body, target_population: enrichment.target_population, scope_facts:enrichment.scope_facts, summary: enrichment.summary, confidence: enrichment.confidence, engine: "openai-responses-enrichment", engine_version: model, updated_at: new Date().toISOString() }, { onConflict: "source_record_id" }).select("id").single();
    if (storedError) throw storedError;
    await supabase.from("record_enrichment_evidence").delete().eq("enrichment_id", stored.id);
    const citedEvidence = [...new Set(enrichment.evidence_ordinals)].map((ordinal) => chunks[ordinal - 1]).filter(Boolean);
    if (citedEvidence.length) { const { error } = await supabase.from("record_enrichment_evidence").insert(citedEvidence.map((chunk) => ({ enrichment_id: stored.id, evidence_chunk_id: chunk.id }))); if (error) throw error; }
    await supabase.from("source_records").update({ enrichment_status: "completed", enrichment_error: null, processing_status: "preparat", updated_at: new Date().toISOString() }).eq("id", record.id);
    console.log(`${record.source_record_id}: contrast oficial completat`);
  } catch (error) {
    const message = formatError(error);
    await supabase.from("source_records").update({ enrichment_status: "error", enrichment_error: message.slice(0, 1000), processing_status: "error", updated_at: new Date().toISOString() }).eq("id", recordId);
    throw new Error(message);
  }
}

function formatError(error: unknown) { if (error instanceof Error) return error.message; if (error && typeof error === "object") { const value = error as Record<string, unknown>; return [value.message,value.details,value.hint,value.code].filter(Boolean).join(" · ") || JSON.stringify(value); } return String(error); }
function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
void main().catch((error: unknown) => { console.error("Contrast fallit:", formatError(error)); process.exitCode = 1; });
