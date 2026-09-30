import Link from "next/link";
import { notFound } from "next/navigation";
import { getSourceRecord, createServerSupabase } from "@/lib/records-page";
import { getJobRecord } from "@/lib/job-record";
import { isUuid } from "@/lib/uuid";
import { getReviewList } from "@/lib/review-list";
import { classifyIssue } from "@/lib/issue-types";
import { getCloudResourceBlock } from "@/lib/batches";
import { CaseStudy } from "./study";
import { safeCaseOrigin } from "@/lib/case-origin";
import { getSourcePage } from "@/lib/records-page";
import { getCurrentResults } from "@/lib/current-results";
import { getApprovedPage } from "@/lib/approved";
import { recordReviewLabel } from "@/lib/record-review-state";

type ContextRow = { id: string; jobId?: string | null; provisionId?: string };
async function contextPage(path: string, p: URLSearchParams, page: number): Promise<{ rows: ContextRow[]; pageCount: number }> {
  const query = (p.get("q") ?? "").slice(0, 120);
  const type = p.get("type") ?? "totes";
  if (path === "/") {
    const result = await getSourcePage({ page, query, type });
    return { rows: result.records.map(row => ({ id: row.id })), pageCount: result.pageCount };
  }
  if (path === "/approved") {
    const result = await getApprovedPage({ page, query, type });
    return { rows: result.provisions.map(row => ({ id: row.sourceRecordId, provisionId: row.id })), pageCount: result.pageCount };
  }
  const filters = { page, query, type, ...(path === "/discarded" ? { destination: "discarded", reason: p.get("reason") || undefined, batchNumber: /^\d+$/.test(p.get("batch") ?? "") ? Number(p.get("batch")) : undefined } : path === "/analysis" ? { classification: "out_of_portfolio" } : { destination: "issues" }) };
  const result = await getCurrentResults(filters);
  return { rows: result.rows.map(row => ({ id: row.id, jobId: row.job_id })), pageCount: result.pageCount };
}

export default async function RecordPage({ params, searchParams }: PageProps<"/records/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const jobId = typeof query.job === "string" && isUuid(query.job) ? query.job : null;
  const record = jobId ? await getJobRecord(jobId) : await getSourceRecord(id);
  if (!record || record.id !== id) notFound();
  const services = await createServerSupabase().from("eligible_official_services").select("service_code,service_name,target_population").order("service_code");
  const cloudBlock = await getCloudResourceBlock();
  if (services.error) throw services.error;
  const origin = safeCaseOrigin(query.from);
  let previous: string | null = null;
  let next: string | null = null;
  if (origin.startsWith("/review")) {
    const originUrl = new URL(origin, "http://local.invalid");
    const p = originUrl.searchParams;
    const page = Math.max(1, Number.parseInt(p.get("page") ?? "1", 10) || 1);
    const filters = { page, query: p.get("q") ?? "", type: p.get("type") ?? "totes", state: p.get("state") === "all" ? "all" as const : "pending" as const, batchId: p.get("batch") && isUuid(p.get("batch")!) ? p.get("batch")! : undefined };
    const list = await getReviewList(filters);
    const at = list.rows.findIndex(row => row.id === id && (!jobId || row.jobId === jobId));
    const makeHref = (row: typeof list.rows[number] | undefined, targetPage = page) => row ? `/records/${row.id}?${new URLSearchParams({ ...(row.jobId ? { job: row.jobId } : {}), from: `/review?${new URLSearchParams({ ...Object.fromEntries(p), page: String(targetPage) })}` })}` : null;
    if (at >= 0) {
      previous = makeHref(list.rows[at - 1]);
      next = makeHref(list.rows[at + 1]);
      if (!previous && page > 1) previous = makeHref((await getReviewList({ ...filters, page: page - 1 })).rows.at(-1), page - 1);
      if (!next && page < list.pageCount) next = makeHref((await getReviewList({ ...filters, page: page + 1 })).rows[0], page + 1);
    }
  } else {
    const originUrl = new URL(origin, "http://local.invalid");
    const path = originUrl.pathname;
    if (["/", "/approved", "/discarded", "/analysis", "/issues"].includes(path)) {
      const p = originUrl.searchParams;
      const page = Math.max(1, Number.parseInt(p.get("page") ?? "1", 10) || 1);
      const list = await contextPage(path, p, page);
      const at = list.rows.findIndex(row => row.id === id && (path !== "/approved" || !query.provision || row.provisionId === query.provision));
      const makeHref = (row: ContextRow | undefined, targetPage: number) => row ? `/records/${row.id}?${new URLSearchParams({ ...(row.jobId ? { job: row.jobId } : {}), ...(row.provisionId ? { provision: row.provisionId } : {}), from: `${path}?${new URLSearchParams({ ...Object.fromEntries(p), page: String(targetPage) })}` })}` : null;
      if (at >= 0) {
        previous = makeHref(list.rows[at - 1], page);
        next = makeHref(list.rows[at + 1], page);
        if (!previous && page > 1) previous = makeHref((await contextPage(path, p, page - 1)).rows.at(-1), page - 1);
        if (!next && page < list.pageCount) next = makeHref((await contextPage(path, p, page + 1)).rows[0], page + 1);
      }
    }
  }
  return <main className="page-shell"><section className="page-container space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href={origin} className="inline-block text-sm underline underline-offset-2">← Tornar al llistat</Link><nav aria-label="Navegació entre casos" className="flex gap-2 text-sm">{previous && <Link className="rounded-md border px-3 py-2" href={previous}>Anterior</Link>}{next && <Link className="rounded-md border px-3 py-2" href={next}>Següent</Link>}</nav></div>
    <div><p className="page-eyebrow">Estudi del cas · {record.sourceRecordId}{record.batchNumber ? ` · Lot ${record.batchNumber}` : ""}</p><h1 className="page-title max-w-[75ch] break-words">{record.title}</h1><p className="page-description">{recordReviewLabel(record)}</p></div>
    <nav aria-label="Apartats del cas" className="flex flex-wrap gap-4 text-sm"><a href="#resultat" className="underline">Resultat</a><a href="#evidencies" className="underline">Evidències</a><a href="#dades" className="underline">Dades</a><a href="#historial" className="underline">Historial</a><a href="#decisio" className="font-semibold underline lg:hidden">Anar a la decisió</a></nav>
    <CaseStudy initialRecord={record} services={(services.data ?? []).map(service => ({ code: service.service_code, name: service.service_name, scope: service.target_population }))} origin={origin} next={next} issue={classifyIssue(record)} cloudBlocked={Boolean(cloudBlock)} />
  </section></main>;
}
