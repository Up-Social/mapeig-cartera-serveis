import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

type SourceRow = { id: string; source_payload: Record<string, unknown> };
type DocumentRow = {
  source_record_id: string; url: string; url_hash: string; document_type: string;
  source_fields: string[]; status: "discovered"; updated_at: string;
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const runId = option("--run-id");
if (!url || !key) throw new Error("Falten les variables de Supabase a .env.local");
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as never },
});

async function main() {
  if (runId) {
    const { data, error } = await supabase.from("pipeline_jobs").select("source_records(id,source_payload)").eq("run_id", runId);
    if (error) throw error;
    const records = (data ?? []).flatMap((job) => Array.isArray(job.source_records) ? job.source_records as SourceRow[] : job.source_records ? [job.source_records as unknown as SourceRow] : []);
    const documents = records.flatMap(discoverRecordDocuments);
    for (let start = 0; start < documents.length; start += 250) {
      const { error: writeError } = await supabase.from("source_documents").upsert(documents.slice(start, start + 250), { onConflict: "source_record_id,url_hash", ignoreDuplicates: true });
      if (writeError) throw writeError;
    }
    console.log(`Lot ${runId}: ${records.length} registres · ${documents.length} documents descoberts`);
    return;
  }
  let offset = 0;
  let discovered = 0;
  while (true) {
    const { data, error } = await supabase.from("source_records")
      .select("id,source_payload").order("id").range(offset, offset + 999);
    if (error) throw error;
    const records = (data ?? []) as SourceRow[];
    if (!records.length) break;
    const documents = records.flatMap(discoverRecordDocuments);
    for (let start = 0; start < documents.length; start += 250) {
      const batch = documents.slice(start, start + 250);
      const { error: writeError } = await supabase.from("source_documents").upsert(batch, {
        onConflict: "source_record_id,url_hash", ignoreDuplicates: true,
      });
      if (writeError) throw writeError;
    }
    discovered += documents.length;
    offset += records.length;
    console.log(`${offset} registres revisats · ${discovered} documents descoberts`);
    if (records.length < 1000) break;
  }
  console.log(`Descobriment completat: ${discovered} documents vinculats`);
}

function discoverRecordDocuments(record: SourceRow): DocumentRow[] {
  const byUrl = new Map<string, { fields: string[]; type: string }>();
  for (const [field, value] of Object.entries(record.source_payload ?? {})) {
    if (typeof value !== "string") continue;
    for (const candidate of value.match(/https?:\/\/[^\s|]+/gi) ?? []) {
      const normalized = normalizeUrl(candidate);
      if (!normalized) continue;
      const existing = byUrl.get(normalized);
      if (existing) {
        if (!existing.fields.includes(field)) existing.fields.push(field);
      } else {
        byUrl.set(normalized, { fields: [field], type: classify(field) });
      }
    }
  }
  const now = new Date().toISOString();
  return [...byUrl.entries()].map(([documentUrl, metadata]) => ({
    source_record_id: record.id,
    url: documentUrl,
    url_hash: createHash("sha256").update(documentUrl).digest("hex"),
    document_type: metadata.type,
    source_fields: metadata.fields.sort(),
    status: "discovered",
    updated_at: now,
  }));
}

function normalizeUrl(candidate: string) {
  const cleaned = candidate.replace(/[),.;]+$/g, "");
  try {
    const parsed = new URL(cleaned);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch { return null; }
}

function classify(field: string) {
  const name = field.toLocaleLowerCase("ca");
  if (name.includes("bases reguladores")) return "regulatory_basis";
  if (name.includes("annex") || name.includes("descàrrega annex")) return "annex";
  if (name.includes("document conveni")) return "agreement";
  if (name.includes("diari oficial") || name.includes("última publicación")) return "publication";
  if (name.includes("órgano de contratación")) return "contracting_profile";
  return "other";
}
function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

void main().catch((error: unknown) => {
  console.error("Descobriment fallit:", error);
  process.exitCode = 1;
});
