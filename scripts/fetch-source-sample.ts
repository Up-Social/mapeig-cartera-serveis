import {EXTRACTION_VERSION,recoverPdfText} from '../lib/pipeline/readable-document';
import { createHash } from "node:crypto";
import {fetchOfficialDocument} from "../lib/pipeline/official-resolution";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { createWorker } from "tesseract.js";
import {
  buildSourcePayloadEvidence,
  isUnusableWebExtraction,
} from "../lib/source-evidence";

type Document = {
  id: string;
  url: string;
  document_type: string;
  status?: string;
  source_records?:
    | { source_payload?: Record<string, unknown> }
    | Array<{ source_payload?: Record<string, unknown> }>;
};
const execFileAsync = promisify(execFile);
const MAX_TEXT = 200_000;
const TIMEOUT_MS = 20_000;
const DEFAULT_TYPES = ["technical_specifications", "agreement", "publication", "regulatory_basis", "contracting_profile", "annex"];
const requestedTypes = option("--types")?.split(",").map((value) => value.trim()).filter(Boolean);
const runId = option("--run-id");
const ocrEnabled = process.argv.includes("--ocr");
const typeOrder = requestedTypes?.length ? requestedTypes : DEFAULT_TYPES;

const sampleSize = parsePositiveInt(option("--limit") ?? "20");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Falten les variables de Supabase a .env.local");
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as never },
});

async function main() {
  const documents = await selectStratifiedSample(sampleSize);
  console.log(`Mostra seleccionada: ${documents.length} URL úniques`);
  for (const [index, document] of documents.entries()) {
    await update(document.id, { status: "fetching", error_message: null });
    try {
      const fetched = await withTimeout(fetchOfficialDocument(document.url), TIMEOUT_MS + 5_000, "Temps total de descàrrega excedit");
      let extraction = await extract(fetched.bytes, fetched.mimeType, fetched.finalUrl, ocrEnabled);
      if (isUnusableWebExtraction(extraction.text)) {
        const payloadText = buildSourcePayloadEvidence(documentPayload(document));
        if (payloadText) {
          extraction = { text: payloadText, method: "source-payload-fallback", partial:false, coverage:null };
        }
      }
      if (extraction.partial) throw new Error("Extracció incompleta o il·legible: cal revisar la cobertura i recuperar les pàgines afectades amb OCR");
      if (extraction.text.length < 50) throw new Error("Tipus no compatible: document sense text extraïble; cal OCR");
      await update(document.id, {
        status: "fetched", http_status: fetched.status, mime_type: fetched.mimeType,
        resolved_url: fetched.finalUrl, byte_size: fetched.bytes.length,
        content_hash: createHash("sha256").update(fetched.bytes).digest("hex"),
        extracted_text: extraction.text, text_length: extraction.text.length,
        text_preview: extraction.text.slice(0, 600),
        extraction_version: EXTRACTION_VERSION, extraction_coverage: extraction.coverage, extraction_partial: extraction.partial,
        extraction_method: extraction.method, error_message: null,
        fetched_at: new Date().toISOString(),
      });
      console.log(`[${index + 1}/${documents.length}] OK ${document.document_type} · ${extraction.text.length} caràcters`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await update(document.id, { status: message.startsWith("Tipus no compatible") ? "unsupported" : "error", error_message: message.slice(0, 1000), fetched_at: new Date().toISOString() });
      console.log(`[${index + 1}/${documents.length}] ERROR ${document.document_type} · ${message}`);
    }
  }
}

async function selectStratifiedSample(limit: number) {
  if (runId) {
    const { data: jobs, error: jobsError } = await supabase.from("pipeline_jobs").select("source_record_id").eq("run_id", runId).match(process.env.WORKFLOW_JOB_ID?{id:process.env.WORKFLOW_JOB_ID}:{});
    if (jobsError) throw jobsError;
    const recordIds = (jobs ?? []).map((job) => job.source_record_id);
    if (!recordIds.length) return [];
    const statuses = ocrEnabled ? ["discovered", "error", "unsupported"] : ["discovered", "error"];
    const data: (Document & {source_record_id:string})[] = [];
    for (let start=0;;start+=500) {
      const page = await supabase.from("source_documents").select("id,url,document_type,status,source_record_id,source_records(source_payload)").in("source_record_id", recordIds).in("status", statuses).order("id").range(start,start+499);
      if(page.error) throw page.error;
      data.push(...(page.data??[]) as (Document & {source_record_id:string})[]);
      if((page.data?.length??0)<500) break;
    }
    const priority = new Map(typeOrder.map((type, index) => [type, index]));
    const selectedByRecord = new Map<string, Document[]>();
    for (const item of (data ?? []).sort((a, b) => {
      const ocrPriority = ocrEnabled ? Number(b.status === "unsupported") - Number(a.status === "unsupported") : 0;
      return ocrPriority || (priority.get(a.document_type) ?? 99) - (priority.get(b.document_type) ?? 99);
    })) {
      const current = selectedByRecord.get(item.source_record_id) ?? [];
      current.push(item as Document); selectedByRecord.set(item.source_record_id, current);
    }
    return [...selectedByRecord.values()].flat();
  }
  const selected: Document[] = [];
  const urls = new Set<string>();
  const perType = Math.max(1, Math.ceil(limit / typeOrder.length));
  for (const type of typeOrder) {
    const { data, error } = await supabase.from("source_documents").select("id,url,document_type,source_records(source_payload)")
      .eq("status", "discovered").eq("document_type", type).order("id").limit(perType * 10);
    if (error) throw error;
    for (const item of (data ?? []) as Document[]) {
      if (selected.filter((entry) => entry.document_type === type).length >= perType) break;
      if (!urls.has(item.url)) { urls.add(item.url); selected.push(item); }
    }
  }
  if (selected.length < limit) {
    const { data, error } = await supabase.from("source_documents").select("id,url,document_type,source_records(source_payload)")
      .eq("status", "discovered").order("id").limit(limit * 20);
    if (error) throw error;
    for (const item of (data ?? []) as Document[]) {
      if (selected.length >= limit) break;
      if (!urls.has(item.url)) { urls.add(item.url); selected.push(item); }
    }
  }
  return selected.slice(0, limit);
}

async function extract(bytes: Buffer, mimeType: string, finalUrl: string, allowOcr: boolean) {
  if (mimeType.includes("pdf") || finalUrl.toLowerCase().endsWith(".pdf") || bytes.subarray(0, 4).toString() === "%PDF") {
    const directory = await mkdtemp(path.join(tmpdir(), "mapeig-source-"));
    try {
      const input = path.join(directory, "source.pdf");
      const output = path.join(directory, "source.txt");
      await writeFile(input, bytes);
      let raw="";
      try {await execFileAsync("pdftotext", ["-layout", input, output], { timeout: TIMEOUT_MS, maxBuffer: MAX_TEXT * 2 });raw=await readFile(output,"utf8");} catch(error) {if(!allowOcr)throw error;}
      const info=await execFileAsync('pdfinfo',[input],{timeout:TIMEOUT_MS});
      const pageCount=Number(info.stdout.match(/Pages:\s+(\d+)/)?.[1]);
      if(!pageCount)throw new Error('PDF sense recompte de pàgines verificable');
      return await recoverPdfText(raw,allowOcr,async page=>{
        const prefix=path.join(directory,'page');
        await execFileAsync('pdftoppm',['-png','-r','200','-f',String(page),'-l',String(page),'-singlefile',input,prefix],{timeout:120_000});
        const worker=await createWorker(['cat','spa'],undefined,{cachePath:path.join(tmpdir(),'mapeig-tesseract-cache')});
        try {return (await worker.recognize(prefix+'.png')).data.text;} finally {await worker.terminate();}
      },pageCount);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  if (mimeType.includes("html") || mimeType === "text/plain") {
    const raw = bytes.toString("utf8");
    return { text: cleanText(htmlToText(raw)), method: mimeType.includes("html") ? "html-basic" : "plain-text", partial: raw.length > MAX_TEXT, coverage: null };
  }
  throw new Error(`Tipus no compatible: ${mimeType || "desconegut"}`);
}

function htmlToText(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}
function cleanText(text: string) { return text.replace(/\r/g, "").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT); }
function documentPayload(document: Document) {
  const source = Array.isArray(document.source_records)
    ? document.source_records[0]
    : document.source_records;
  return source?.source_payload ?? {};
}
async function update(id: string, values: Record<string, unknown>) { const { error } = await supabase.from("source_documents").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id); if (error) throw error; }
function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function parsePositiveInt(value: string) { const parsed = Number.parseInt(value, 10); if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new Error("--limit ha de ser entre 1 i 100"); return parsed; }
async function withTimeout<T>(operation: Promise<T>, milliseconds: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { if (timer) clearTimeout(timer); }
}

void main().catch((error: unknown) => { console.error("Extracció fallida:", error); process.exitCode = 1; });
