import {createHash} from "node:crypto";
import {createServerSupabase} from "@/lib/records-page";
import {resesProposalArchivePath, type ResesProposal} from "@/lib/reses-proposals";

export async function GET(_request: Request, {params}: RouteContext<"/api/entities/pending/[registry]/proposals/[proposal]/evidence/[index]">) {
  const {registry, proposal, index} = await params;
  if (!/^S[0-9]{5}$/.test(registry) || !/^[0-9a-f-]{36}$/.test(proposal) || !/^[0-9]$/.test(index)) return new Response("No trobat", {status: 404});
  const db = createServerSupabase();
  const result = await db.from("reses_identity_proposal_overview").select("*").eq("id", proposal).eq("registry_number", registry).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return new Response("No trobat", {status: 404});
  const p = result.data as ResesProposal;
  const path = resesProposalArchivePath(p, Number(index));
  if (!path) return new Response("Evidència no disponible", {status: 404});
  const file = await db.storage.from("cloud-documents").download(path);
  if (file.error || !file.data) return new Response("Còpia arxivada no disponible", {status: 503});
  const bytes = Buffer.from(await file.data.arrayBuffer());
  const evidence = p.payload.evidence[Number(index)];
  if (createHash("sha256").update(bytes).digest("hex") !== evidence.sha256) return new Response("La còpia no supera la verificació d’integritat", {status: 409});
  // HTML evidence is inert text, never executable inside the authenticated app.
  return new Response(bytes, {headers: {"Content-Type": evidence.format === "pdf" ? "application/pdf" : "text/plain; charset=utf-8",
    "Content-Disposition": `inline; filename="${registry}-evidencia-${index}.${evidence.format === "pdf" ? "pdf" : "txt"}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"}});
}
