import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import {discoverResolvedDocuments} from "../lib/pipeline/discovery";

type SourceRow = { id: string; source_payload: Record<string, unknown> };
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
    const { data, error } = await supabase.from("pipeline_jobs").select("source_records(id,source_payload)").eq("run_id", runId).match(process.env.WORKFLOW_JOB_ID?{id:process.env.WORKFLOW_JOB_ID}:{});
    if (error) throw error;
    const records = (data ?? []).flatMap((job) => Array.isArray(job.source_records) ? job.source_records as SourceRow[] : job.source_records ? [job.source_records as unknown as SourceRow] : []);
    const documents = (await Promise.all(records.map(discoverResolvedDocuments))).flat();
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
    const documents = (await Promise.all(records.map(discoverResolvedDocuments))).flat();
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

function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

void main().catch((error: unknown) => {
  console.error("Descobriment fallit:", error);
  process.exitCode = 1;
});
