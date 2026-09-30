import {splitText,normalize,hash} from "../lib/pipeline/chunks";
import {documentQuality} from "../lib/evidence-eligibility";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

type Document = { id: string; source_record_id: string; extracted_text: string; extraction_method: string | null };
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const runId = option("--run-id");
if (!supabaseUrl || !serviceKey) throw new Error("Falten les variables de Supabase a .env.local");
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as never },
});

async function main() {
  const limit = Number.parseInt(option("--limit") ?? "100", 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit ha de ser entre 1 i 1000");
  let recordIds: string[] | undefined;
  if (runId) {
    const { data: jobs, error: jobsError } = await supabase.from("pipeline_jobs").select("source_record_id").eq("run_id", runId).match(process.env.WORKFLOW_JOB_ID?{id:process.env.WORKFLOW_JOB_ID}:{});
    if (jobsError) throw jobsError;
    recordIds = (jobs ?? []).map((job) => job.source_record_id);
    if (!recordIds.length) return;
  }
  const documents: Document[] = [];
  for(let start=0;;start+=500) {
    let request = supabase.from("source_documents").select("id,extracted_text,extraction_method,source_record_id").eq("status","fetched").not("extracted_text","is",null).order("fetched_at").order("id");
    if(recordIds) request=request.in("source_record_id",recordIds);
    const page=await request.range(start,start+(recordIds?499:Math.min(500,limit-start)-1));
    if(page.error) throw page.error;
    documents.push(...(page.data??[]) as Document[]);
    if((page.data?.length??0)<500 || (!recordIds && documents.length>=limit)) break;
  }
  const normalizedHashes = documents.map((document) => hash(normalize(document.extracted_text)));
  const seen = new Set<string>();

  let totalChunks = 0;
  for (const [index, document] of documents.entries()) {
    const normalized = normalize(document.extracted_text);
    const chunks = splitText(normalized);
    const textHash = normalizedHashes[index];
    const identity = `${document.source_record_id}:${textHash}`;
    const assessment = documentQuality(normalized, document.extraction_method ?? "", seen.has(identity));
    seen.add(identity);
    const flags = assessment.qualityFlags;
    const quality = assessment.qualityScore;

    const rows = chunks.map((content, ordinal) => ({
      source_document_id: document.id, ordinal, content, content_hash: hash(content), character_count: content.length,
    }));
    const {error:updateError}=await supabase.rpc('replace_document_chunks',{p_document:document.id,p_chunks:rows,p_metadata:{text_preview:normalized.slice(0,600),extracted_text_hash:textHash,quality_score:quality,quality_flags:flags}});
    if (updateError) throw updateError;
    totalChunks += chunks.length;
    console.log(`${index + 1}/${documents.length} · ${chunks.length} fragments · qualitat ${quality.toFixed(2)}${flags.length ? ` · ${flags.join(", ")}` : ""}`);
  }
  console.log(`Fragmentació completada: ${documents.length} documents · ${totalChunks} fragments`);
}

function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

void main().catch((error: unknown) => { console.error("Fragmentació fallida:", error); process.exitCode = 1; });
