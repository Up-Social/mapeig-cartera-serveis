import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

type Document = { id: string; extracted_text: string; extraction_method: string | null };
const CHUNK_SIZE = 1_200;
const OVERLAP = 180;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const runId = option("--run-id");
if (!supabaseUrl || !serviceKey) throw new Error("Falten les variables de Supabase a .env.local");
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as never },
});

async function main() {
  const limit = Number.parseInt(option("--limit") ?? "100", 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit ha de ser entre 1 i 1000");
  let request = supabase.from("source_documents").select("id,extracted_text,extraction_method,source_record_id").eq("status", "fetched").not("extracted_text", "is", null).order("fetched_at").limit(limit);
  if (runId) {
    const { data: jobs, error: jobsError } = await supabase.from("pipeline_jobs").select("source_record_id").eq("run_id", runId);
    if (jobsError) throw jobsError;
    request = request.in("source_record_id", (jobs ?? []).map((job) => job.source_record_id));
  }
  const { data, error } = await request;
  if (error) throw error;
  const documents = (data ?? []) as Document[];
  const normalizedHashes = documents.map((document) => hash(normalize(document.extracted_text)));
  const frequencies = new Map<string, number>();
  normalizedHashes.forEach((value) => frequencies.set(value, (frequencies.get(value) ?? 0) + 1));

  let totalChunks = 0;
  for (const [index, document] of documents.entries()) {
    const normalized = normalize(document.extracted_text);
    const chunks = splitText(normalized);
    const textHash = normalizedHashes[index];
    const flags: string[] = [];
    if (normalized.length < 1_000) flags.push("short_text");
    if ((frequencies.get(textHash) ?? 0) > 1) flags.push("duplicate_text");
    if (document.extraction_method === "html-basic") flags.push("basic_html_extraction");
    const quality = scoreQuality(normalized.length, flags);

    const rows = chunks.map((content, ordinal) => ({
      source_document_id: document.id, ordinal, content, content_hash: hash(content), character_count: content.length,
    }));
    if (rows.length) {
      const { error: chunkError } = await supabase.from("evidence_chunks").upsert(rows, { onConflict: "source_document_id,ordinal" });
      if (chunkError) throw chunkError;
    }
    const { error: updateError } = await supabase.from("source_documents").update({
      text_preview: normalized.slice(0, 600), extracted_text_hash: textHash,
      quality_score: quality, quality_flags: flags, chunk_count: chunks.length, updated_at: new Date().toISOString(),
    }).eq("id", document.id);
    if (updateError) throw updateError;
    totalChunks += chunks.length;
    console.log(`${index + 1}/${documents.length} · ${chunks.length} fragments · qualitat ${quality.toFixed(2)}${flags.length ? ` · ${flags.join(", ")}` : ""}`);
  }
  console.log(`Fragmentació completada: ${documents.length} documents · ${totalChunks} fragments`);
}

function splitText(text: string) {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_SIZE);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      const sentence = text.lastIndexOf(". ", end);
      const boundary = Math.max(paragraph, sentence);
      if (boundary > start + CHUNK_SIZE * 0.6) end = boundary + (boundary === sentence ? 1 : 0);
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - OVERLAP);
  }
  return chunks;
}
function scoreQuality(length: number, flags: string[]) {
  let score = length >= 3_000 ? 1 : length >= 1_000 ? 0.85 : length >= 300 ? 0.65 : 0.35;
  if (flags.includes("duplicate_text")) score -= 0.25;
  if (flags.includes("basic_html_extraction")) score -= 0.1;
  return Math.max(0, Math.min(1, score));
}
function normalize(text: string) { return text.replace(/\r/g, "").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

void main().catch((error: unknown) => { console.error("Fragmentació fallida:", error); process.exitCode = 1; });
