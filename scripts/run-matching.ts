import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MATCHING_MODEL;
if (!url || !key || !openaiKey || !model) throw new Error("Falten variables de Supabase o OpenAI");
if (process.env.MATCHING_CATALOG_SOURCE !== "master" || process.env.ALLOW_MASTER_MATCHING !== "true") throw new Error("El catàleg Master no està autoritzat per al matching");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as never } });
const runIdArg = process.argv.indexOf("--run-id");
const runId = runIdArg >= 0 ? process.argv[runIdArg + 1] : undefined;
const allowPreviousSelection = process.argv.includes("--allow-previous-selection");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number.parseInt(process.argv[limitArg + 1] ?? "1", 10) : runId ? 50 : 1;
if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("--limit ha de ser entre 1 i 50");

type CandidateOutput = { code: string; score: number; rationale: string; evidence_ordinals: number[]; evidence_explanation: string };
type EnrichmentOutput = { title: string | null; provider_name: string | null; provider_nif: string | null; mechanism: string | null; award_date: string | null; amount: number | null; contracting_body: string | null; target_population: string | null; summary: string; confidence: number; evidence_ordinals: number[] };

async function main() {
  let request = supabase.from("pipeline_jobs").select("id,run_id,source_record_id").eq("status", runId ? "ready" : "queued").order("created_at").limit(limit);
  if (runId) request = request.eq("run_id", runId);
  const { data: jobs, error } = await request;
  if (error) throw error;
  if (!jobs?.length) throw new Error("No hi ha treballs en cua");
  for (const job of jobs) await processJob(job);
  if (runId && jobs.length) await finishRunIfDone(runId);
}

async function processJob(job: { id: string; run_id: string; source_record_id: string }) {
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase.from("pipeline_jobs").update({ status: "matching", claimed_at: claimedAt, attempts: 1, error_message: null }).eq("id", job.id).in("status", ["queued", "ready"]).select("id").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return;
  await supabase.from("source_records").update({ processing_status: "processant", updated_at: claimedAt }).eq("id", job.source_record_id);

  try {
    await assertNotPreviouslySelected(job.source_record_id, job.id, allowPreviousSelection);
    const [{ data: record, error: recordError }, { data: catalog, error: catalogError }] = await Promise.all([
      supabase.from("source_records").select("id,source_dataset,source_record_id,mechanism,title,provider_name,amount,source_payload,record_enrichments(id,summary,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population),source_documents!inner(id,status)").eq("id", job.source_record_id).eq("source_documents.status", "fetched").single(),
      supabase.from("master_services").select("service_code,service_name,sector_scope").eq("portfolio_status", "Dentro").order("service_code"),
    ]);
    if (recordError) throw recordError;
    if (catalogError) throw catalogError;
    const documentIds = record.source_documents.map((document: { id: string }) => document.id);
    const { data: chunks, error: chunksError } = await supabase.from("evidence_chunks").select("id,ordinal,content,source_document_id").in("source_document_id", documentIds).order("ordinal").limit(12);
    if (chunksError) throw chunksError;
    if (!chunks?.length) throw new Error("El registre no té fragments d'evidència");

    const existingEnrichment = Array.isArray(record.record_enrichments) ? record.record_enrichments[0] : record.record_enrichments;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: existingEnrichment ? matchingInstructions() : `Primer extreu camps estructurats exclusivament dels fragments oficials; usa null si no hi consten. ${matchingInstructions()}`,
        input: buildInput({ ...record, verified_enrichment: existingEnrichment }, catalog ?? [], chunks),
        text: { format: { type: "json_schema", name: "matching_candidates", strict: true, schema: existingEnrichment ? candidatesOnlySchema() : combinedSchema() } },
        max_output_tokens: 1800,
      }),
    });
    const raw = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${JSON.stringify(raw)}`);
    const parsed = JSON.parse(extractOutputText(raw)) as { enrichment?: EnrichmentOutput; candidates: CandidateOutput[] };
    const catalogByCode = new Map((catalog ?? []).map((item) => [item.service_code, item]));
    const candidates = parsed.candidates.filter((candidate) => catalogByCode.has(candidate.code)).slice(0, 3);
    if (!candidates.length) throw new Error("La resposta no conté cap candidat vàlid del catàleg");

    if (parsed.enrichment) await persistEnrichment(record.id, parsed.enrichment, chunks);

    await supabase.from("matching_candidates").delete().eq("pipeline_job_id", job.id);
    for (const [index, candidate] of candidates.entries()) {
      const target = catalogByCode.get(candidate.code)!;
      const { data: inserted, error: candidateError } = await supabase.from("matching_candidates").insert({ pipeline_job_id: job.id, target_catalog: "master", target_code: candidate.code, target_name: target.service_name, rank: index + 1, score: candidate.score, rationale: candidate.rationale, engine: "openai-responses", engine_version: model, raw_response: { response_id: raw.id, usage: raw.usage } }).select("id").single();
      if (candidateError) throw candidateError;
      const evidence = [...new Set(candidate.evidence_ordinals)].map((ordinal) => chunks[ordinal - 1]).filter(Boolean);
      if (evidence.length) {
        const { error: evidenceError } = await supabase.from("matching_candidate_evidence").insert(evidence.map((chunk) => ({ candidate_id: inserted.id, evidence_chunk_id: chunk.id, explanation: candidate.evidence_explanation })));
        if (evidenceError) throw evidenceError;
      }
    }
    await supabase.from("pipeline_jobs").update({ status: "needs_review", completed_at: new Date().toISOString() }).eq("id", job.id);
    await supabase.from("source_records").update({ processing_status: "revisio", updated_at: new Date().toISOString() }).eq("id", job.source_record_id);
    await addUsage(job.run_id, raw.usage);
    await finishRunIfDone(job.run_id);
    console.log(`${record.source_record_id}: ${candidates.length} candidats · revisió necessària`);
  } catch (error) {
    const message = formatError(error);
    await supabase.from("pipeline_jobs").update({ status: "error", error_message: message, completed_at: new Date().toISOString() }).eq("id", job.id);
    await supabase.from("source_records").update({ processing_status: "error", updated_at: new Date().toISOString() }).eq("id", job.source_record_id);
    console.error(`${job.source_record_id}: ${message}`);
  }
}

async function assertNotPreviouslySelected(sourceRecordId: string, currentJobId: string, allowPrevious: boolean) {
  const { count: currentCandidates, error: currentCandidatesError } = await supabase.from("matching_candidates").select("id", { count: "exact", head: true }).eq("pipeline_job_id", currentJobId);
  if (currentCandidatesError) throw currentCandidatesError;
  if (currentCandidates) throw new Error("Cas omès: aquest treball ja té un resultat de matching desat.");
  if (allowPrevious) return;
  const { data: record, error: recordError } = await supabase.from("source_records").select("deduplication_key").eq("id", sourceRecordId).single();
  if (recordError) throw recordError;
  const { data: equivalents, error: equivalentsError } = await supabase.from("source_records").select("id").eq("deduplication_key", record.deduplication_key);
  if (equivalentsError) throw equivalentsError;
  const ids = (equivalents ?? []).map((item) => item.id);
  const { data: otherJobs, error } = await supabase
    .from("pipeline_jobs")
    .select("run_id,status,matching_candidates(id)")
    .in("source_record_id", ids)
    .neq("id", currentJobId);
  if (error) throw error;
  const blockingJobs = (otherJobs ?? []).filter(
    (item) =>
      item.status !== "error" &&
      (item.status === "ready" ||
        item.status === "matching" ||
        (Array.isArray(item.matching_candidates) &&
          item.matching_candidates.length > 0)),
  );
  const runIds = [...new Set(blockingJobs.map((item) => item.run_id))];
  const { data: runs, error: runsError } = runIds.length ? await supabase.from("pipeline_runs").select("parameters").in("id", runIds) : { data: [], error: null };
  if (runsError) throw runsError;
  if ((runs ?? []).some((run) => run.parameters?.purpose !== "inspection")) throw new Error("Cas omès: aquest registre o un duplicat ja havia entrat en un altre lot de matching.");
}

function candidatesSchema() { return { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["code","score","rationale","evidence_ordinals","evidence_explanation"], properties: { code: { type: "string" }, score: { type: "number", minimum: 0, maximum: 1 }, rationale: { type: "string", minLength: 60, maxLength: 1200 }, evidence_ordinals: { type: "array", items: { type: "integer", minimum: 1 } }, evidence_explanation: { type: "string", minLength: 20, maxLength: 450 } } } }; }
function candidatesOnlySchema() { return { type: "object", additionalProperties: false, required: ["candidates"], properties: { candidates: candidatesSchema() } }; }
function combinedSchema() { return { type: "object", additionalProperties: false, required: ["enrichment","candidates"], properties: { enrichment: { type: "object", additionalProperties: false, required: ["title","provider_name","provider_nif","mechanism","award_date","amount","contracting_body","target_population","summary","confidence","evidence_ordinals"], properties: { title: nullableString(), provider_name: nullableString(), provider_nif: nullableString(), mechanism: nullableString(), award_date: nullableString(), amount: { anyOf: [{ type: "number" }, { type: "null" }] }, contracting_body: nullableString(), target_population: nullableString(), summary: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, evidence_ordinals: { type: "array", items: { type: "integer", minimum: 1 } } }, }, candidates: candidatesSchema() } }; }

function buildInput(record: Record<string, unknown>, catalog: Array<Record<string, unknown>>, chunks: Array<{ content: string }>) {
  return `PROVISIÓ\n${JSON.stringify({ dataset: record.source_dataset, id: record.source_record_id, mechanism: record.mechanism, title: record.title, provider: record.provider_name, amount: record.amount, original: sanitizeSourcePayload(record.source_payload) })}\n\nEVIDÈNCIA OFICIAL\n${chunks.map((chunk, index) => `[${index + 1}] ${chunk.content}`).join("\n\n")}\n\nCATÀLEG\n${catalog.map((item) => `${item.service_code} | ${item.service_name} | ${item.sector_scope ?? ""}`).join("\n")}`;
}

function sanitizeSourcePayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key, field]) =>
    !key.startsWith("Fórmula ·") && !(typeof field === "string" && field.trim().startsWith("=")),
  ));
}

function extractOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) if (item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)) for (const content of (item as { content: Array<Record<string, unknown>> }).content) if (content.type === "output_text" && typeof content.text === "string") return content.text;
  throw new Error("OpenAI no ha retornat text estructurat");
}

function nullableString() { return { anyOf: [{ type: "string" }, { type: "null" }] }; }
function matchingInstructions() { return "Classifica la provisió contra el catàleg utilitzant les dades contrastades i els fragments oficials. Proposa com a màxim tres candidats ordenats. El rationale ha de tenir exactament tres línies: 'Encaix:', que relacioni un fet concret de la prestació amb el servei; 'Diferenciació:', que el compari amb els altres candidats; i 'Limitació:', que indiqui una diferència o dada absent real. evidence_explanation ha de resumir en una o dues frases quina dada oficial sobre l'objecte, actuacions, població o modalitat sustenta l'encaix. No usis import, pressupost, CPV ni òrgan com a evidència principal si no són determinants. No inventis codis ni fets. Una puntuació baixa és preferible a una falsa certesa. Respon en català professional i concís."; }

async function persistEnrichment(sourceRecordId: string, enrichment: EnrichmentOutput, chunks: Array<{ id: string }>) {
  const awardDate = enrichment.award_date && /^\d{4}-\d{2}-\d{2}$/.test(enrichment.award_date) ? enrichment.award_date : null;
  const { data, error } = await supabase.from("record_enrichments").upsert({ source_record_id: sourceRecordId, extracted_title: enrichment.title, provider_name: enrichment.provider_name, provider_nif: enrichment.provider_nif, mechanism: enrichment.mechanism, award_date: awardDate, amount: enrichment.amount, contracting_body: enrichment.contracting_body, target_population: enrichment.target_population, summary: enrichment.summary, confidence: enrichment.confidence, engine: "openai-responses", engine_version: model, updated_at: new Date().toISOString() }, { onConflict: "source_record_id" }).select("id").single();
  if (error) throw error;
  const { error: deleteError } = await supabase.from("record_enrichment_evidence").delete().eq("enrichment_id", data.id);
  if (deleteError) throw deleteError;
  const evidence = [...new Set(enrichment.evidence_ordinals)].map((ordinal) => chunks[ordinal - 1]).filter(Boolean);
  if (evidence.length) {
    const { error: evidenceError } = await supabase.from("record_enrichment_evidence").insert(evidence.map((chunk) => ({ enrichment_id: data.id, evidence_chunk_id: chunk.id })));
    if (evidenceError) throw evidenceError;
  }
  await supabase.from("source_records").update({ enrichment_status: "completed", enrichment_error: null, updated_at: new Date().toISOString() }).eq("id", sourceRecordId);
}

async function finishRunIfDone(runId: string) {
  const { data, error } = await supabase.from("pipeline_jobs").select("status").eq("run_id", runId);
  if (error) throw error;
  const finished = (data ?? []).filter((job) => ["needs_review", "approved", "corrected", "rejected", "insufficient_evidence"].includes(job.status)).length;
  const pending = (data ?? []).some((job) => job.status === "ready" || job.status === "matching" || job.status === "queued");
  const review = (data ?? []).filter((job) => job.status === "needs_review").length;
  await supabase.from("pipeline_runs").update({ status: pending ? "matching" : "needs_review", stage: pending ? "matching" : "review", processed_count: finished, review_count: review, completed_at: pending ? null : new Date().toISOString() }).eq("id", runId);
  if (!pending) { const { error: refreshError } = await supabase.rpc("refresh_pipeline_run", { p_run_id: runId }); if (refreshError) throw refreshError; }
}

async function addUsage(id: string, value: unknown) {
  const usage = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const { data } = await supabase.from("pipeline_runs").select("actual_input_tokens,actual_output_tokens").eq("id", id).single();
  if (!data) return;
  const inputTokens = Number(data.actual_input_tokens ?? 0) + Number(usage.input_tokens ?? 0);
  const outputTokens = Number(data.actual_output_tokens ?? 0) + Number(usage.output_tokens ?? 0);
  const { error } = await supabase.from("pipeline_runs").update({ actual_input_tokens: inputTokens, actual_output_tokens: outputTokens }).eq("id", id);
  if (error) throw error;
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return [value.message, value.details, value.hint, value.code].filter(Boolean).join(" · ") || JSON.stringify(value);
  }
  return String(error);
}

void main().catch((error: unknown) => { console.error("Matching fallit:", formatError(error)); process.exitCode = 1; });
