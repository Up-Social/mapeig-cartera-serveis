import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Falten les variables de Supabase a .env.local");
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as never },
});

async function main() {
  const [documents, chunks, queuedJobs, catalogEntries] = await Promise.all([
    count("source_documents", "status", "fetched"),
    count("evidence_chunks"),
    count("pipeline_jobs", "status", "queued"),
    count("master_services"),
  ]);
  const catalogSource = process.env.MATCHING_CATALOG_SOURCE;
  const masterAuthorized = process.env.ALLOW_MASTER_MATCHING === "true";
  const checks = [
    { label: "OpenAI API key", ready: Boolean(process.env.OPENAI_API_KEY), detail: process.env.OPENAI_API_KEY ? "configurada" : "falta OPENAI_API_KEY" },
    { label: "Model", ready: Boolean(process.env.OPENAI_MATCHING_MODEL), detail: process.env.OPENAI_MATCHING_MODEL ? "configurat" : "falta OPENAI_MATCHING_MODEL" },
    { label: "Evidència", ready: documents > 0 && chunks > 0, detail: `${documents} documents · ${chunks} fragments` },
    { label: "Catàleg", ready: catalogSource === "official" || (catalogSource === "master" && masterAuthorized), detail: catalogDetail(catalogSource, masterAuthorized, catalogEntries) },
    { label: "Treballs en cua", ready: queuedJobs > 0, detail: `${queuedJobs} treballs` },
  ];
  console.log("Preparació del matching\n");
  checks.forEach((check) => console.log(`${check.ready ? "OK" : "PENDENT"} · ${check.label}: ${check.detail}`));
  console.log(`\nEstat: ${checks.every((check) => check.ready) ? "PREPARAT" : "BLOQUEJAT"}`);
}

async function count(table: string, column?: string, expected?: string) {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  if (column && expected) query = query.eq(column, expected);
  const { count: value, error } = await query;
  if (error) throw error;
  return value ?? 0;
}
function catalogDetail(source: string | undefined, masterAuthorized: boolean, entries: number) {
  if (source === "official") return "catàleg oficial seleccionat; pendent de verificar càrrega";
  if (source === "master" && masterAuthorized) return `Master autoritzat explícitament · ${entries} entrades`;
  if (source === "master") return "Master seleccionat però falta ALLOW_MASTER_MATCHING=true";
  return "falta MATCHING_CATALOG_SOURCE=official|master";
}

void main().catch((error: unknown) => { console.error("Comprovació fallida:", error); process.exitCode = 1; });
