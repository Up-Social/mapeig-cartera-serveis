import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import WebSocket from "ws";

type Scalar = string | number | boolean | null;
type Payload = Record<string, Scalar>;
type ImportRow = {
  source_dataset: string; source_record_id: string; mechanism: string; title: string;
  provider_name: string | null; amount: number | null; processing_status: "pendent";
  source_file: string; source_sheet: string; source_row: number;
  source_payload: Payload; source_payload_hash: string; updated_at: string;
};
type MasterServiceRow = {
  service_code: string; service_name: string; sector_scope: string | null;
  portfolio_status: string | null; general_confidence: string | null;
  source_file: string; source_sheet: string; source_row: number;
  source_payload: Payload; source_payload_hash: string; updated_at: string;
};
type SourceSpec = {
  file: string; sheets: string[]; dataset: (sheet: string) => string; mechanism: string;
  id: (row: Payload) => string; title: (row: Payload) => string;
  provider: (row: Payload) => string | null; amount: (row: Payload) => number | null;
};

const specs: SourceSpec[] = [
  {
    file: "Contrataciones. Consolidado 2024-2026.xlsx", sheets: ["Contrataciones"],
    dataset: () => "contractacions", mechanism: "Contractació pública",
    id: (row) => `${text(row["Código del expediente"]) || "sense-expedient"}::${shortHash(text(row["Enlace de la última publicación"]) || stableJson(row))}`,
    title: (row) => text(row["Denominación"]) || text(row["Descripción de la prestación"]),
    provider: (row) => nullableText(row["Denominación del adjudicatario"]),
    amount: (row) => firstNumber(row["Importe de adjudicación"], row["Presupuesto de licitación"], row["Valor estimado del contrato"]),
  },
  {
    file: "Convenios. Consolidado 2024-2026.xlsx", sheets: ["Convenios"],
    dataset: () => "convenis", mechanism: "Conveni",
    id: (row) => text(row["Número conveni definitiu"]),
    title: (row) => text(row["Títol conveni"]) || text(row["Objecte"]),
    provider: (row) => nullableText(row["Altres Organismes Signants"])
      || nullableText(row["Organismes signants ens locals"])
      || nullableText(row["Organismes signants per part de la Generalitat"]),
    amount: (row) => firstNumber(row["Sumatori aportacions totals previstes"]),
  },
  {
    file: "Subvenciones. RAISC Consolidado 2024-2026.xlsx", sheets: ["CCAA", "Local"],
    dataset: (sheet) => sheet === "CCAA" ? "raisc_ccaa" : "raisc_local", mechanism: "Subvenció",
    id: (row) => text(row["Clau"]),
    title: (row) => text(row["Títol convocatòria català"]) || text(row["Objecte de la convocatòria"]) || text(row["Títol convocatòria castellà"]),
    provider: (row) => nullableText(row["Raó social del beneficiari"]),
    amount: (row) => firstNumber(row["Import subvenció / préstec / ajut"]),
  },
];
const masterFile = "Master. Mapeo Cartera Serveis Socials.xlsx";

const args = process.argv.slice(2);
const sourceDir = option("--source-dir");
const masterOnly = args.includes("--master-only");
const limitValue = option("--limit");
const limit = limitValue ? Number.parseInt(limitValue, 10) : undefined;
if (!sourceDir) throw new Error("Falta --source-dir /ruta/a/la/carpeta");
if (limitValue && (!Number.isInteger(limit) || (limit ?? 0) < 1)) throw new Error("--limit ha de ser un enter positiu");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Falten les variables de Supabase a .env.local");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as never },
});

async function main() {
  const { data: run, error: runError } = await supabase.from("import_runs").insert({
    source_directory: path.resolve(sourceDir!), files: masterOnly ? [masterFile] : [...specs.map((spec) => spec.file), masterFile],
  }).select("id").single();
  if (runError) throw runError;

  let rowsRead = 0;
  let rowsWritten = 0;
  try {
  for (const spec of masterOnly ? [] : specs) {
    const filePath = path.join(sourceDir!, spec.file);
    await access(filePath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    for (const sheetName of spec.sheets) {
      const worksheet = workbook.getWorksheet(sheetName);
      if (!worksheet) throw new Error(`No existeix el full ${sheetName} a ${spec.file}`);
      const headers = worksheet.getRow(1).values as ExcelJS.CellValue[];
      const batch: ImportRow[] = [];
      let sheetRows = 0;
      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        if (limit && sheetRows >= limit) break;
        const payload = payloadFromRow(headers, worksheet.getRow(rowNumber));
        if (Object.values(payload).every((value) => value === null || value === "")) continue;
        const sourceRecordId = spec.id(payload);
        const title = spec.title(payload);
        if (!sourceRecordId || !title) throw new Error(`Fila ${rowNumber} invàlida a ${spec.file}/${sheetName}: falta ID o títol`);
        batch.push({
          source_dataset: spec.dataset(sheetName), source_record_id: sourceRecordId,
          mechanism: spec.mechanism, title, provider_name: spec.provider(payload), amount: spec.amount(payload),
          processing_status: "pendent", source_file: spec.file, source_sheet: sheetName, source_row: rowNumber,
          source_payload: payload,
          source_payload_hash: createHash("sha256").update(stableJson(payload)).digest("hex"),
          updated_at: new Date().toISOString(),
        });
        rowsRead += 1; sheetRows += 1;
        if (batch.length === 250) { rowsWritten += await writeBatch(batch); batch.length = 0; }
      }
      if (batch.length) rowsWritten += await writeBatch(batch);
      console.log(`${spec.dataset(sheetName)}: ${sheetRows} files importades`);
    }
  }
  const masterRows = await importMaster(path.join(sourceDir!, masterFile));
  rowsRead += masterRows;
  rowsWritten += masterRows;
  const { error } = await supabase.from("import_runs").update({
    status: "completed", rows_read: rowsRead, rows_written: rowsWritten, completed_at: new Date().toISOString(),
  }).eq("id", run.id);
  if (error) throw error;
  console.log(`Importació completada: ${rowsWritten}/${rowsRead} files escrites`);
  } catch (error) {
    await supabase.from("import_runs").update({
      status: "failed", rows_read: rowsRead, rows_written: rowsWritten,
      error_message: error instanceof Error ? error.message : String(error), completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error("Importació fallida:", error);
  process.exitCode = 1;
});

async function writeBatch(rows: ImportRow[]) {
  const { error } = await supabase.from("source_records").upsert(rows, { onConflict: "source_dataset,source_record_id" });
  if (error) throw error;
  await syncImportedEntities(rows);
  return rows.length;
}
async function syncImportedEntities(rows: ImportRow[]) {
  if (!rows.length) return;
  const dataset = rows[0].source_dataset;
  const stored = await supabase.from("source_records").select("id,source_record_id,provider_name,source_payload").eq("source_dataset", dataset).in("source_record_id", rows.map((row) => row.source_record_id));
  if (stored.error) throw stored.error;
  const parsed = (stored.data ?? []).map((record) => {
    const payload = (record.source_payload ?? {}) as Record<string, unknown>;
    const nif = Object.entries(payload).filter(([key]) => /\b(nif|cif)\b/i.test(key)).map(([, value]) => normalizeNif(String(value ?? ""))).find(Boolean) ?? null;
    return { ...record, nif, normalizedName: normalizeName(record.provider_name ?? "") };
  }).filter((record) => record.provider_name);
  const nifs = [...new Set(parsed.map((record) => record.nif).filter((value): value is string => Boolean(value)))];
  const existing = nifs.length ? await supabase.from("entities").select("id,nif").in("nif", nifs) : { data: [], error: null };
  if (existing.error) throw existing.error;
  const entityIds = new Map((existing.data ?? []).map((entity) => [entity.nif, entity.id]));
  const missing = parsed.filter((record) => record.nif && !entityIds.has(record.nif)).filter((record, index, all) => all.findIndex((item) => item.nif === record.nif) === index);
  if (missing.length) {
    const inserted = await supabase.from("entities").insert(missing.map((record) => ({ legal_name: record.provider_name!, normalized_name: record.normalizedName, nif: record.nif, validation_status: "source_verified", active: true }))).select("id,nif");
    if (inserted.error) throw inserted.error;
    for (const entity of inserted.data ?? []) entityIds.set(entity.nif, entity.id);
  }
  const now = new Date().toISOString();
  const mentions = parsed.map((record) => ({ source_record_id: record.id, raw_name: record.provider_name!, normalized_name: record.normalizedName, nif: record.nif, role: "provider", source: "excel_import", entity_id: record.nif ? entityIds.get(record.nif) ?? null : null, resolution_status: record.nif && entityIds.has(record.nif) ? "linked_by_nif" : "unresolved", evidence: record.nif && entityIds.has(record.nif) ? `NIF exacte ${record.nif}; contrastat amb el directori RESES local` : "Entitat importada sense NIF exacte resoluble", updated_at: now }));
  const mentionResult = await supabase.from("entity_mentions").upsert(mentions, { onConflict: "source_record_id,normalized_name,role,source" });
  if (mentionResult.error) throw mentionResult.error;
  const links = parsed.flatMap((record) => record.nif && entityIds.has(record.nif) ? [{ source_record_id: record.id, entity_id: entityIds.get(record.nif)!, role: "provider", origin: "source", evidence: `NIF exacte ${record.nif}` }] : []);
  if (links.length) { const linkResult = await supabase.from("source_record_entities").upsert(links, { onConflict: "source_record_id,entity_id,role,origin" }); if (linkResult.error) throw linkResult.error; }
  const aliases = [...new Map(parsed.flatMap((record) => record.nif && entityIds.has(record.nif) ? [{ entity_id: entityIds.get(record.nif)!, alias: record.provider_name!, normalized_alias: record.normalizedName, source: `excel:${dataset}`, last_seen_at: now }] : []).map((alias) => [`${alias.entity_id}:${alias.normalized_alias}:${alias.source}`, alias])).values()];
  if (aliases.length) { const aliasResult = await supabase.from("entity_aliases").upsert(aliases, { onConflict: "entity_id,normalized_alias,source" }); if (aliasResult.error) throw aliasResult.error; }
}
async function importMaster(filePath: string) {
  await access(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet("Tabla (resumen)");
  if (!worksheet) throw new Error(`No existeix el full Tabla (resumen) a ${masterFile}`);
  const headers = [
    "Código Cartera", "Nombre del servicio", "Ámbito sectorial / colectivo",
    "Estado", "Concierto importe", "Concierto provisiones", "Subvención importe",
    "Subvención provisiones", "Convenio importe", "Convenio provisiones",
    "Contratación importe", "Contratación provisiones", "Importe total",
    "Mecanismo dominante", "Confianza general", "% Drets Socials", "% otros departamentos",
    "Nº entidades prestadoras", "Plazas / capacidad",
  ];
  const rows: MasterServiceRow[] = [];
  for (let rowNumber = 4; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const serviceCode = text(cellValue(worksheet.getCell(rowNumber, 1).value));
    const serviceName = text(cellValue(worksheet.getCell(rowNumber, 2).value));
    if (!serviceCode || !serviceName) continue;
    const payload: Payload = {};
    headers.forEach((header, index) => {
      const cell = worksheet.getCell(rowNumber, index + 1);
      payload[header] = masterCellValue(cell);
      const formula = cellFormula(cell.value);
      if (formula) payload[`Fórmula · ${header}`] = formula;
    });
    rows.push({
      service_code: serviceCode, service_name: serviceName,
      sector_scope: nullableText(payload["Ámbito sectorial / colectivo"]),
      portfolio_status: nullableText(payload.Estado),
      general_confidence: nullableText(payload["Confianza general"]),
      source_file: masterFile, source_sheet: "Tabla (resumen)", source_row: rowNumber,
      source_payload: payload,
      source_payload_hash: createHash("sha256").update(stableJson(payload)).digest("hex"),
      updated_at: new Date().toISOString(),
    });
  }
  const { error } = await supabase.from("master_services").upsert(rows, { onConflict: "service_code" });
  if (error) throw error;
  console.log(`master_services: ${rows.length} serveis importats`);
  return rows.length;
}
function option(name: string) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function payloadFromRow(headers: ExcelJS.CellValue[], row: ExcelJS.Row): Payload {
  const payload: Payload = {};
  for (let column = 1; column < headers.length; column += 1) {
    const header = text(cellValue(headers[column]));
    if (header) payload[header] = cellValue(row.getCell(column).value);
  }
  return payload;
}
function cellValue(value: ExcelJS.CellValue, formulaFallback = true): Scalar {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if ("result" in value && value.result !== undefined && value.result !== null) return cellValue(value.result);
  if (formulaFallback && "formula" in value && typeof value.formula === "string") return `=${value.formula}`;
  if (formulaFallback && "sharedFormula" in value && typeof value.sharedFormula === "string") return `=${value.sharedFormula}`;
  if (!formulaFallback && ("formula" in value || "sharedFormula" in value)) return null;
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("hyperlink" in value) return value.hyperlink;
  return String(value);
}
function masterCellValue(cell: ExcelJS.Cell): Scalar {
  if (cell.result !== undefined && cell.result !== null) return cellValue(cell.result, false);
  return cellValue(cell.value, false);
}
function cellFormula(value: ExcelJS.CellValue): string | null {
  if (value === null || typeof value !== "object" || value instanceof Date) return null;
  if ("formula" in value && typeof value.formula === "string") return `=${value.formula}`;
  if ("sharedFormula" in value && typeof value.sharedFormula === "string") return `=${value.sharedFormula}`;
  return null;
}
function text(value: Scalar) { return value === null ? "" : String(value).trim(); }
function nullableText(value: Scalar) { return text(value) || null; }
function firstNumber(...values: Scalar[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) { const parsed = Number(value.replace(",", ".")); if (Number.isFinite(parsed)) return parsed; }
  }
  return null;
}
function stableJson(value: Payload) { return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))); }
function shortHash(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 12); }
function normalizeNif(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function normalizeName(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
