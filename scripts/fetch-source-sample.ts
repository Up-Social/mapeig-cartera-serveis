import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
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
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 200_000;
const TIMEOUT_MS = 20_000;
const DEFAULT_TYPES = ["agreement", "publication", "regulatory_basis", "contracting_profile", "annex"];
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
      const fetched = await withTimeout(fetchWithLimits(document.url), TIMEOUT_MS + 5_000, "Temps total de descàrrega excedit");
      let extraction = await extract(fetched.bytes, fetched.mimeType, fetched.finalUrl, ocrEnabled);
      if (isUnusableWebExtraction(extraction.text)) {
        const payloadText = buildSourcePayloadEvidence(documentPayload(document));
        if (payloadText) {
          extraction = { text: payloadText, method: "source-payload-fallback" };
        }
      }
      if (extraction.text.length < 50) throw new Error("Tipus no compatible: document sense text extraïble; cal OCR");
      await update(document.id, {
        status: "fetched", http_status: fetched.status, mime_type: fetched.mimeType,
        resolved_url: fetched.finalUrl, byte_size: fetched.bytes.length,
        content_hash: createHash("sha256").update(fetched.bytes).digest("hex"),
        extracted_text: extraction.text, text_length: extraction.text.length,
        text_preview: extraction.text.slice(0, 600),
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
    const { data: jobs, error: jobsError } = await supabase.from("pipeline_jobs").select("source_record_id").eq("run_id", runId);
    if (jobsError) throw jobsError;
    const recordIds = (jobs ?? []).map((job) => job.source_record_id);
    if (!recordIds.length) return [];
    const statuses = ocrEnabled ? ["discovered", "error", "unsupported"] : ["discovered", "error"];
    const { data, error } = await supabase.from("source_documents").select("id,url,document_type,status,source_record_id,source_records(source_payload)").in("source_record_id", recordIds).in("status", statuses).limit(1000);
    if (error) throw error;
    const priority = new Map(typeOrder.map((type, index) => [type, index]));
    const selectedByRecord = new Map<string, Document[]>();
    for (const item of (data ?? []).sort((a, b) => {
      const ocrPriority = ocrEnabled ? Number(b.status === "unsupported") - Number(a.status === "unsupported") : 0;
      return ocrPriority || (priority.get(a.document_type) ?? 99) - (priority.get(b.document_type) ?? 99);
    })) {
      const current = selectedByRecord.get(item.source_record_id) ?? [];
      if (current.length < 2) { current.push(item as Document); selectedByRecord.set(item.source_record_id, current); }
    }
    return [...selectedByRecord.values()].flat().slice(0, limit);
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

async function fetchWithLimits(initialUrl: string) {
  let current = new URL(initialUrl);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Mapeig-cartera-serveis-PoC/0.1" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirecció ${response.status} sense destinació`);
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new Error(`Document massa gran: ${declared} bytes`);
    const bytes = await readLimitedBody(response);
    const headerType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const mimeType = headerType || inferMime(current.pathname, bytes);
    return { bytes, mimeType, finalUrl: current.toString(), status: response.status };
  }
  throw new Error("Massa redireccions");
}

async function readLimitedBody(response: Response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error(`Document supera ${MAX_BYTES} bytes`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function extract(bytes: Buffer, mimeType: string, finalUrl: string, allowOcr: boolean) {
  if (mimeType.includes("pdf") || finalUrl.toLowerCase().endsWith(".pdf") || bytes.subarray(0, 4).toString() === "%PDF") {
    const directory = await mkdtemp(path.join(tmpdir(), "mapeig-source-"));
    try {
      const input = path.join(directory, "source.pdf");
      const output = path.join(directory, "source.txt");
      await writeFile(input, bytes);
      await execFileAsync("pdftotext", ["-layout", input, output], { timeout: TIMEOUT_MS, maxBuffer: MAX_TEXT * 2 });
      const text = cleanText(await readFile(output, "utf8"));
      if (text.length >= 50 || !allowOcr) return { text, method: "pdftotext" };
      return await extractPdfWithOcr(input, directory);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  if (mimeType.includes("html") || mimeType === "text/plain") {
    const raw = bytes.toString("utf8");
    return { text: cleanText(htmlToText(raw)), method: mimeType.includes("html") ? "html-basic" : "plain-text" };
  }
  throw new Error(`Tipus no compatible: ${mimeType || "desconegut"}`);
}

async function extractPdfWithOcr(input: string, directory: string) {
  const prefix = path.join(directory, "page");
  await execFileAsync("pdftoppm", ["-png", "-r", "200", "-f", "1", "-l", "25", input, prefix], {
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const pages = (await readdir(directory))
    .filter((name) => name.startsWith("page-") && name.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!pages.length) throw new Error("OCR fallit: el PDF no conté pàgines processables");
  const worker = await createWorker(["cat", "spa"], undefined, {
    cachePath: path.join(tmpdir(), "mapeig-tesseract-cache"),
  });
  try {
    const texts: string[] = [];
    for (const page of pages) {
      const result = await worker.recognize(path.join(directory, page));
      texts.push(result.data.text);
    }
    const text = cleanText(texts.join("\n\n"));
    if (text.length < 50) throw new Error("OCR fallit: no s'ha reconegut prou text al document");
    return { text, method: "tesseract-ocr" };
  } finally {
    await worker.terminate();
  }
}

async function assertPublicUrl(url: URL) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Protocol no permès");
  if (url.username || url.password) throw new Error("Credencials a la URL no permeses");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Destinació de xarxa privada no permesa");
}

function isPrivateAddress(address: string) {
  if (!isIP(address)) return true;
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
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
function inferMime(pathname: string, bytes: Buffer) { return pathname.toLowerCase().endsWith(".pdf") || bytes.subarray(0, 4).toString() === "%PDF" ? "application/pdf" : "application/octet-stream"; }
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
