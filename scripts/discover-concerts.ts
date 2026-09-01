import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const API_URL = "https://tauler.seu-e.cat/api/edictes";
const DETAIL_BASE_URL = "https://tauler.seu-e.cat/detall";
const ENTITY_ID = "1";
const LOCALE = "ca";
const PAGE_SIZE = 25;
const PERIOD_START = "2024-01-01";
const PERIOD_END = "2026-12-31";
const SEARCH_TERMS = ["concert social", "gestió delegada social"] as const;

type Edict = {
  id_edicte: string;
  titol: string;
  descripcio: string;
  tags: string[];
  classificacions: Array<{ concepte: string; categoria: string; subcategoria: string | null; tipus: number }>;
  data_publicacio: string;
  data_retirada: string | null;
};

type SearchResponse = {
  totalEdictes: number;
  edictes: Edict[];
  totalPages: number;
  currentPage: number;
};

type EventType =
  | "nova_provisio_o_ampliacio"
  | "prorroga"
  | "modificacio"
  | "autoritzacio_despesa"
  | "resolucio_anticipada_o_baixa"
  | "cessio"
  | "esmena"
  | "altres";

type DiscoveredConcert = Edict & {
  source_dataset: "concerts";
  financing_type: "concert";
  source_record_id: string;
  record_url: string;
  matched_terms: string[];
  event_type: EventType;
  counts_as_new_financing: boolean;
  source_payload_hash: string;
};

type DiscoveryReport = {
  generated_at: string;
  mode: "dry-run";
  database_writes: 0;
  source: { api: string; entity_id: string; locale: string; search_terms: readonly string[] };
  period: { from: string; to: string };
  query_totals: Record<string, number>;
  unique_results_all_dates: number;
  records_to_import_after_confirmation: number;
  records_classified_as_new_financing: number;
  event_counts: Record<string, number>;
  records: DiscoveredConcert[];
};

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function containsExactSearchExpression(edict: Edict, term: string) {
  return normalized(`${edict.titol} ${edict.descripcio}`).includes(normalized(term));
}

function classifyEvent(edict: Edict): { eventType: EventType; countsAsNewFinancing: boolean } {
  const text = normalized(`${edict.titol} ${edict.descripcio}`);
  if (/resolucio anticipada|extincio|baixa|retirada|finalitzacio/.test(text)) {
    return { eventType: "resolucio_anticipada_o_baixa", countsAsNewFinancing: false };
  }
  if (/prorroga/.test(text)) return { eventType: "prorroga", countsAsNewFinancing: false };
  if (/modificacio|modifica /.test(text)) return { eventType: "modificacio", countsAsNewFinancing: false };
  if (/esmena|correccio/.test(text)) return { eventType: "esmena", countsAsNewFinancing: false };
  if (/cessio/.test(text)) return { eventType: "cessio", countsAsNewFinancing: false };
  if (/autoritzacio de la despesa/.test(text)) {
    return { eventType: "autoritzacio_despesa", countsAsNewFinancing: false };
  }
  if (/provisio de places|provisio de serveis|provisio directa|convocatoria.*provisio|assignacio de places/.test(text)) {
    return { eventType: "nova_provisio_o_ampliacio", countsAsNewFinancing: true };
  }
  return { eventType: "altres", countsAsNewFinancing: false };
}

async function fetchPage(term: string, page: number): Promise<SearchResponse> {
  const url = new URL(API_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(PAGE_SIZE));
  url.searchParams.set("sort", "dataPublicacioEfectiva,desc");
  url.searchParams.set("ens", ENTITY_ID);
  url.searchParams.set("locale", LOCALE);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "mapeig-cartera-serveis-poc/0.1" },
    body: JSON.stringify({ conceptes: [], cerca: term, destacat: null, state: "0" }),
  });
  if (!response.ok) throw new Error(`e-Tauler ha respost ${response.status} a ${url}`);
  return response.json() as Promise<SearchResponse>;
}

async function discoverTerm(term: string) {
  const first = await fetchPage(term, 0);
  const rows = [...first.edictes];
  for (let page = 1; page < first.totalPages; page += 1) {
    const result = await fetchPage(term, page);
    rows.push(...result.edictes);
  }
  return { reportedTotal: first.totalEdictes, rows };
}

function toDiscovered(edict: Edict, matchedTerms: string[]): DiscoveredConcert {
  const classification = classifyEvent(edict);
  const payload = { ...edict, matched_terms: matchedTerms };
  return {
    ...edict,
    source_dataset: "concerts",
    financing_type: "concert",
    source_record_id: `etauler:${ENTITY_ID}:${edict.id_edicte}`,
    record_url: `${DETAIL_BASE_URL}?idEns=${ENTITY_ID}&idEdicte=${edict.id_edicte}`,
    matched_terms: matchedTerms,
    event_type: classification.eventType,
    counts_as_new_financing: classification.countsAsNewFinancing,
    source_payload_hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
}

async function main() {
  if (process.argv.includes("--commit")) {
    throw new Error("Utilitza --import --confirm-count N; --commit no és un argument vàlid.");
  }
  const importRequested = process.argv.includes("--import");
  const output = path.resolve(option("--output") ?? "tmp/concerts-discovery.json");
  if (importRequested) {
    const confirmedCount = Number.parseInt(option("--confirm-count") ?? "", 10);
    if (!Number.isInteger(confirmedCount) || confirmedCount < 1) {
      throw new Error("La importació requereix --confirm-count amb el recompte autoritzat.");
    }
    const report = JSON.parse(await readFile(output, "utf8")) as DiscoveryReport;
    if (report.records_to_import_after_confirmation !== confirmedCount || report.records.length !== confirmedCount) {
      throw new Error(`Recompte no coincident: autoritzat ${confirmedCount}, informe ${report.records.length}. Torna a executar la descoberta.`);
    }
    await importRecords(report, output);
    return;
  }

  const results = await Promise.all(SEARCH_TERMS.map(async (term) => ({ term, ...(await discoverTerm(term)) })));
  const byId = new Map<string, { edict: Edict; terms: Set<string> }>();
  for (const result of results) {
    for (const edict of result.rows.filter((row) => containsExactSearchExpression(row, result.term))) {
      const current = byId.get(edict.id_edicte) ?? { edict, terms: new Set<string>() };
      current.terms.add(result.term);
      byId.set(edict.id_edicte, current);
    }
  }

  const records = [...byId.values()]
    .filter(({ edict }) => edict.data_publicacio >= PERIOD_START && edict.data_publicacio <= PERIOD_END)
    .map(({ edict, terms }) => toDiscovered(edict, [...terms]))
    .sort((a, b) => a.data_publicacio.localeCompare(b.data_publicacio) || a.id_edicte.localeCompare(b.id_edicte));

  const eventCounts = Object.fromEntries(
    [...new Set(records.map((record) => record.event_type))]
      .sort()
      .map((eventType) => [eventType, records.filter((record) => record.event_type === eventType).length]),
  );
  const report: DiscoveryReport = {
    generated_at: new Date().toISOString(),
    mode: "dry-run",
    database_writes: 0,
    source: { api: API_URL, entity_id: ENTITY_ID, locale: LOCALE, search_terms: SEARCH_TERMS },
    period: { from: PERIOD_START, to: PERIOD_END },
    query_totals: Object.fromEntries(results.map((result) => [result.term, result.reportedTotal])),
    unique_results_all_dates: byId.size,
    records_to_import_after_confirmation: records.length,
    records_classified_as_new_financing: records.filter((record) => record.counts_as_new_financing).length,
    event_counts: eventCounts,
    records,
  };

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("Descoberta de concerts completada (sense escriure a Supabase)");
  console.log(`Període: ${PERIOD_START} — ${PERIOD_END}`);
  for (const result of results) console.log(`Consulta “${result.term}”: ${result.reportedTotal} anuncis`);
  console.log(`Anuncis únics dins del període: ${records.length}`);
  console.log(`Possibles noves provisions/ampliacions: ${report.records_classified_as_new_financing}`);
  console.log(`Informe: ${output}`);
}

async function importRecords(report: DiscoveryReport, reportPath: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Falten les variables de Supabase a .env.local");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  });
  const ids = report.records.map((record) => record.source_record_id);
  if (new Set(ids).size !== ids.length) throw new Error("L'informe conté identificadors duplicats.");
  const { data: existing, error: existingError } = await supabase.from("source_records")
    .select("id,source_record_id")
    .eq("source_dataset", "concerts");
  if (existingError) throw existingError;
  const expectedIds = new Set(ids);
  const stale = (existing ?? []).filter((record) => !expectedIds.has(String(record.source_record_id)));
  if (stale.length > 0) {
    const confirmedDelete = Number.parseInt(option("--confirm-delete") ?? "", 10);
    if (!process.argv.includes("--prune") || confirmedDelete !== stale.length) {
      throw new Error(`Hi ha ${stale.length} concerts fora del nou filtre. Per retirar-los cal --prune --confirm-delete ${stale.length}.`);
    }
    const staleIds = stale.map((record) => String(record.id));
    const { count: usedCount, error: usedError } = await supabase.from("pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .in("source_record_id", staleIds);
    if (usedError) throw usedError;
    if ((usedCount ?? 0) > 0) {
      throw new Error(`No s'esborra res: ${usedCount} registres descartats ja tenen activitat en lots.`);
    }
  }

  const { data: run, error: runError } = await supabase.from("import_runs").insert({
    source_directory: API_URL,
    files: [reportPath],
  }).select("id").single();
  if (runError) throw runError;

  let written = 0;
  try {
    const rows = report.records.map((record, index) => ({
        source_dataset: "concerts",
        source_record_id: record.source_record_id,
        mechanism: "Concert social / gestió delegada",
        title: record.titol.trim(),
        provider_name: null,
        amount: null,
        processing_status: "pendent" as const,
        source_file: API_URL,
        source_sheet: "edictes",
        source_row: index + 2,
        source_payload: {
          ...record,
          connector: "etauler",
          retrieved_at: report.generated_at,
          period_from: report.period.from,
          period_to: report.period.to,
        },
        source_payload_hash: record.source_payload_hash,
        updated_at: new Date().toISOString(),
      }));
    const { error } = await supabase.from("source_records").upsert(rows, {
      onConflict: "source_dataset,source_record_id",
    });
    if (error) throw error;
    written = rows.length;
    if (stale.length > 0) {
      const { data: deletedCount, error: deleteError } = await supabase.rpc(
        "delete_unprocessed_concert_records",
        { record_ids: stale.map((record) => String(record.id)) },
      );
      if (deleteError) throw deleteError;
      if (deletedCount !== stale.length) {
        throw new Error(`Supabase ha retirat ${deletedCount ?? 0} registres; se n'esperaven ${stale.length}.`);
      }
    }
    const { count, error: countError } = await supabase.from("source_records")
      .select("id", { count: "exact", head: true })
      .eq("source_dataset", "concerts");
    if (countError) throw countError;
    if (count !== report.records.length) {
      throw new Error(`Verificació fallida: s'esperaven ${report.records.length} concerts i Supabase en retorna ${count ?? "?"}.`);
    }
    const { error: completeError } = await supabase.from("import_runs").update({
      status: "completed",
      rows_read: report.records.length,
      rows_written: written,
      completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    if (completeError) throw completeError;
    console.log(`Importació verificada: ${count} registres de concerts a Supabase.`);
    console.log(`Escriptures del procés: ${written}.`);
    console.log(`Registres retirats pel filtre: ${stale.length}.`);
  } catch (error) {
    await supabase.from("import_runs").update({
      status: "failed",
      rows_read: report.records.length,
      rows_written: written,
      error_message: error instanceof Error ? error.message : String(error),
      completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
