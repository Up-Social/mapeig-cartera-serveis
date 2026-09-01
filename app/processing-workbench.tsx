"use client";

import { useMemo, useState } from "react";
import type { SourceRecord, ProcessingStatus } from "@/lib/types";

const statusLabels: Record<ProcessingStatus, string> = {
  pendent: "Pendent",
  preparant: "Preparant",
  processant: "Processant",
  completat: "Completat",
  revisio: "Revisió",
  error: "Error",
};

const statusStyles: Record<ProcessingStatus, string> = {
  pendent: "bg-slate-100 text-slate-700",
  preparant: "bg-amber-50 text-amber-700",
  processant: "bg-blue-50 text-blue-700",
  completat: "bg-emerald-50 text-emerald-700",
  revisio: "bg-violet-50 text-violet-700",
  error: "bg-rose-50 text-rose-700",
};

export function ProcessingWorkbench({
  initialRecords,
}: {
  initialRecords: SourceRecord[];
}) {
  const [records, setRecords] = useState(initialRecords);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState(initialRecords[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("totes");
  const [isProcessing, setIsProcessing] = useState(false);

  const sources = useMemo(
    () => [...new Set(records.map((record) => record.sourceDataset))],
    [records],
  );

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ca");
    return records.filter((record) => {
      const matchesSource =
        source === "totes" || record.sourceDataset === source;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        `${record.title} ${record.sourceRecordId} ${record.providerName ?? ""}`
          .toLocaleLowerCase("ca")
          .includes(normalizedQuery);
      return matchesSource && matchesQuery;
    });
  }, [query, records, source]);

  const activeRecord = records.find((record) => record.id === activeId);
  const selectedVisible = filteredRecords.filter((record) =>
    selectedIds.includes(record.id),
  );

  function toggleRecord(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function toggleAllVisible() {
    const visibleIds = filteredRecords.map((record) => record.id);
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) =>
      allSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])],
    );
  }

  async function processSelection() {
    if (selectedIds.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setRecords((current) =>
      current.map((record) =>
        selectedIds.includes(record.id)
          ? { ...record, status: "processant" as const }
          : record,
      ),
    );

    await new Promise((resolve) => window.setTimeout(resolve, 900));

    setRecords((current) =>
      current.map((record, index) => {
        if (!selectedIds.includes(record.id)) return record;
        const needsReview = index % 3 === 1;
        return {
          ...record,
          status: needsReview ? ("revisio" as const) : ("completat" as const),
          carteraCode: needsReview ? "1.2.11.1" : record.suggestedCode,
          carteraName: needsReview
            ? "Servei d'atenció a les famílies"
            : record.suggestedName,
          confidence: needsReview ? 0.76 : record.suggestedConfidence,
          evidence: record.suggestedEvidence,
        };
      }),
    );
    setIsProcessing(false);
    setSelectedIds([]);
  }

  function reviewActive(decision: "completat" | "revisio") {
    if (!activeRecord) return;
    setRecords((current) =>
      current.map((record) =>
        record.id === activeRecord.id
          ? { ...record, status: decision }
          : record,
      ),
    );
  }

  const completed = records.filter(
    (record) => record.status === "completat",
  ).length;
  const review = records.filter((record) => record.status === "revisio").length;

  return (
    <main className="min-h-screen bg-[#f4f6f2] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-5 lg:px-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              UPSocial · Prova de concepte
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Mapeig cartera de serveis.
            </h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            Supabase local
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1500px] px-6 py-6 lg:px-10">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Registres carregats"
            value={records.length.toString()}
          />
          <Metric
            label="Seleccionats"
            value={selectedIds.length.toString()}
            accent="blue"
          />
          <Metric
            label="Completats"
            value={completed.toString()}
            accent="green"
          />
          <Metric
            label="Revisió necessària"
            value={review.toString()}
            accent="violet"
          />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Cua de processament</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Selecciona un lot petit i revisa els resultats abans de
                  continuar.
                </p>
              </div>
              <button
                type="button"
                onClick={processSelection}
                disabled={selectedIds.length === 0 || isProcessing}
                className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isProcessing
                  ? "Processant..."
                  : `Processar lot${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
              </button>
            </div>

            <div className="grid gap-3 border-b border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-[1fr_220px]">
              <label className="sr-only" htmlFor="record-search">
                Cercar registres
              </label>
              <input
                id="record-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cercar per títol, identificador o entitat..."
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
              <label className="sr-only" htmlFor="source-filter">
                Filtrar per font
              </label>
              <select
                id="source-filter"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-emerald-600"
              >
                <option value="totes">Totes les fonts</option>
                {sources.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="w-12 px-4 py-3">
                      <input
                        aria-label="Seleccionar tots els registres visibles"
                        type="checkbox"
                        checked={
                          filteredRecords.length > 0 &&
                          filteredRecords.every((record) =>
                            selectedIds.includes(record.id),
                          )
                        }
                        onChange={toggleAllVisible}
                        className="h-4 w-4 accent-emerald-700"
                      />
                    </th>
                    <th className="px-3 py-3">Registre</th>
                    <th className="px-3 py-3">Font</th>
                    <th className="px-3 py-3">Estat</th>
                    <th className="px-3 py-3">Codi proposat</th>
                    <th className="px-3 py-3">Confiança</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record) => (
                    <tr
                      key={record.id}
                      onClick={() => setActiveId(record.id)}
                      className={`cursor-pointer border-b border-slate-100 transition hover:bg-emerald-50/40 ${
                        activeId === record.id ? "bg-emerald-50/70" : ""
                      }`}
                    >
                      <td
                        className="px-4 py-4"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          aria-label={`Seleccionar ${record.sourceRecordId}`}
                          type="checkbox"
                          checked={selectedIds.includes(record.id)}
                          onChange={() => toggleRecord(record.id)}
                          className="h-4 w-4 accent-emerald-700"
                        />
                      </td>
                      <td className="max-w-md px-3 py-4">
                        <p className="font-medium text-slate-900">
                          {record.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {record.sourceRecordId} ·{" "}
                          {record.providerName ?? "Entitat no evidenciada"}
                        </p>
                      </td>
                      <td className="px-3 py-4 font-medium text-slate-600">
                        {record.sourceDataset}
                      </td>
                      <td className="px-3 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[record.status]}`}
                        >
                          {statusLabels[record.status]}
                        </span>
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-semibold">
                          {record.carteraCode ?? "—"}
                        </p>
                        <p className="mt-1 max-w-56 truncate text-xs text-slate-500">
                          {record.carteraName ?? "Encara sense classificar"}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        {record.confidence == null ? (
                          "—"
                        ) : (
                          <span className="font-semibold">
                            {Math.round(record.confidence * 100)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-5 py-4 text-sm text-slate-500">
              <span>{filteredRecords.length} registres visibles</span>
              <span>
                {selectedVisible.length} seleccionats en aquest filtre
              </span>
            </div>
          </section>

          <aside className="self-start rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-6">
            {activeRecord ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-emerald-700">
                      Detall i evidència
                    </p>
                    <h2 className="mt-2 text-lg font-semibold leading-snug">
                      {activeRecord.title}
                    </h2>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[activeRecord.status]}`}
                  >
                    {statusLabels[activeRecord.status]}
                  </span>
                </div>

                <dl className="mt-5 grid gap-4 border-y border-slate-100 py-5 text-sm">
                  <Detail label="Font" value={activeRecord.sourceDataset} />
                  <Detail
                    label="Identificador"
                    value={activeRecord.sourceRecordId}
                  />
                  <Detail label="Mecanisme" value={activeRecord.mechanism} />
                  <Detail
                    label="Import"
                    value={formatAmount(activeRecord.amount)}
                  />
                </dl>

                <div className="mt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Servei proposat
                  </p>
                  <p className="mt-2 text-sm font-semibold">
                    {activeRecord.carteraCode ?? "Sense proposta"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {activeRecord.carteraName ??
                      "Processa el registre per generar candidats."}
                  </p>
                </div>

                <div className="mt-5 rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Evidència
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {activeRecord.evidence ??
                      "Encara no hi ha evidència. En aquesta fase el processament és simulat per validar el flux de revisió."}
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => reviewActive("revisio")}
                    className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Demanar revisió
                  </button>
                  <button
                    type="button"
                    onClick={() => reviewActive("completat")}
                    disabled={!activeRecord.carteraCode}
                    className="rounded-xl bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Aprovar
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                No hi ha cap registre seleccionat.
              </p>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  accent = "slate",
}: {
  label: string;
  value: string;
  accent?: "slate" | "blue" | "green" | "violet";
}) {
  const accents = {
    slate: "text-slate-950",
    blue: "text-blue-700",
    green: "text-emerald-700",
    violet: "text-violet-700",
  };
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p
        className={`mt-2 text-3xl font-semibold tracking-tight ${accents[accent]}`}
      >
        {value}
      </p>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[105px_1fr] gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function formatAmount(amount: number | null) {
  if (amount == null) return "No informat";
  return new Intl.NumberFormat("ca-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}
