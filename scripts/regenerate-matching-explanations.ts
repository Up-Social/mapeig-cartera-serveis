import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MATCHING_MODEL;
const expectedCount = Number(option("--confirm-count"));
if (!url || !key || !openaiKey || !model) throw new Error("Falten variables de Supabase o OpenAI");
if (!Number.isInteger(expectedCount) || expectedCount < 1) throw new Error("Cal indicar --confirm-count N");

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as never } });

type Candidate = { id: string; rank: number; target_code: string; target_name: string; score: number; rationale: string; matching_candidate_evidence: Array<{ evidence_chunks: { content: string } | null }> };
type Job = { id: string; source_records: { source_record_id: string; title: string; mechanism: string; source_payload: Record<string, unknown> } | null; matching_candidates: Candidate[] };
type Explanation = { candidate_id: string; fit: string; differentiation: string; limitation: string; official_evidence: string };

async function main() {
  const { data, error } = await db.from("pipeline_jobs").select("id,source_records(source_record_id,title,mechanism,source_payload),matching_candidates(id,rank,target_code,target_name,score,rationale,matching_candidate_evidence(evidence_chunks(content)))");
  if (error) throw error;
  const jobs = (data as unknown as Job[]).filter((job) => job.source_records && job.matching_candidates.length > 0);
  const count = jobs.reduce((sum, job) => sum + job.matching_candidates.length, 0);
  if (count !== expectedCount) throw new Error(`Confirmació incorrecta: hi ha ${count} candidats, no ${expectedCount}`);

  let updated = 0;
  for (const job of jobs) {
    const explanations = await explain(job);
    const byId = new Map(explanations.map((item) => [item.candidate_id, item]));
    for (const candidate of job.matching_candidates) {
      const item = byId.get(candidate.id);
      if (!item) throw new Error(`Falta l'explicació del candidat ${candidate.id}`);
      const rationale = `Encaix: ${item.fit}\nDiferenciació: ${item.differentiation}\nLimitació: ${item.limitation}`;
      const candidateUpdate = await db.from("matching_candidates").update({ rationale }).eq("id", candidate.id);
      if (candidateUpdate.error) throw candidateUpdate.error;
      const evidenceUpdate = await db.from("matching_candidate_evidence").update({ explanation: item.official_evidence }).eq("candidate_id", candidate.id);
      if (evidenceUpdate.error) throw evidenceUpdate.error;
      updated += 1;
    }
    console.log(`${job.source_records!.source_record_id}: ${job.matching_candidates.length} explicacions regenerades`);
  }
  console.log(`Regeneració completada: ${updated} candidats`);
}

async function explain(job: Job): Promise<Explanation[]> {
  const candidates = job.matching_candidates.sort((a, b) => a.rank - b.rank);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: "Redacta explicacions de matching en català professional, breus, precises i auditables. No recalculis codis, ordre ni puntuacions. Per a cada candidat: (1) fit ha d'unir un fet concret de la prestació amb la funció del servei candidat; (2) differentiation ha d'explicar per què és més o menys específic que els altres candidats; (3) limitation ha d'identificar una diferència o dada absent real; (4) official_evidence ha de citar o parafrasejar en una o dues frases l'objecte, les actuacions, la població o la modalitat descrits a la font i explicar com sustenten l'encaix. No utilitzis import, pressupost, CPV ni òrgan de contractació com a evidència principal, tret que siguin realment determinants per distingir el servei. Evita frases genèriques, repeticions, anglicismes i afirmacions no presents a les dades.",
      input: JSON.stringify({ record: job.source_records, candidates: candidates.map((candidate) => ({ id: candidate.id, rank: candidate.rank, code: candidate.target_code, name: candidate.target_name, score: candidate.score, current_rationale: candidate.rationale, cited_sources: candidate.matching_candidate_evidence.flatMap((link) => link.evidence_chunks?.content ? [link.evidence_chunks.content] : []) })) }),
      text: { format: { type: "json_schema", name: "matching_explanations", strict: true, schema: schema(candidates.map((candidate) => candidate.id)) } },
      max_output_tokens: 1800,
    }),
  });
  const raw = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${JSON.stringify(raw)}`);
  const parsed = JSON.parse(outputText(raw)) as { explanations: Explanation[] };
  if (parsed.explanations.length !== candidates.length) throw new Error("OpenAI no ha retornat totes les explicacions");
  return parsed.explanations;
}

function schema(ids: string[]) { const explanation = { type: "string", minLength: 20, maxLength: 450 }; return { type: "object", additionalProperties: false, required: ["explanations"], properties: { explanations: { type: "array", minItems: ids.length, maxItems: ids.length, items: { type: "object", additionalProperties: false, required: ["candidate_id","fit","differentiation","limitation","official_evidence"], properties: { candidate_id: { type: "string", enum: ids }, fit: explanation, differentiation: explanation, limitation: explanation, official_evidence: explanation } } } } }; }
function outputText(response: Record<string, unknown>) { if (typeof response.output_text === "string") return response.output_text; const output = Array.isArray(response.output) ? response.output : []; for (const item of output) if (item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)) for (const content of (item as { content: Array<Record<string, unknown>> }).content) if (content.type === "output_text" && typeof content.text === "string") return content.text; throw new Error("OpenAI no ha retornat text estructurat"); }
function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

void main().catch((error: unknown) => { console.error("Regeneració fallida:", error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
