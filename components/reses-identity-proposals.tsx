import {resesProposalRole, resesProposalStatus, type ResesProposal} from "@/lib/reses-proposals";

export function ResesIdentityProposals({proposals, sourceHash}: {proposals: ResesProposal[]; sourceHash: string}) {
  return <section className="surface space-y-4 p-5" id="propostes">
    <h2 className="section-title">Propostes documentades d’identitat</h2>
    <p>Les fonts poden acreditar un proveïdor en un període o un ens responsable. Aquestes propostes no confirmen la titularitat actual, no creen entitats ni acrediten finançament.</p>
    {!proposals.length && <p className="text-sm text-muted-foreground">Encara no hi ha cap proposta amb evidència suficient. El servei continua pendent.</p>}
    {proposals.map(p => <article key={p.id} className="min-w-0 space-y-3 rounded-lg border p-4">
      <p className="font-semibold text-amber-900">{resesProposalStatus(p, sourceHash)}</p>
      <h3 className="break-words font-semibold">{p.payload.proposed_name}</h3>
      <p>NIF proposat: {p.payload.proposed_nif} · {resesProposalRole(p.payload.role)}</p>
      <p>Període acreditat: {p.payload.supported_from || p.payload.supported_to
        ? `${p.payload.supported_from ?? "Inici no acreditat"} — ${p.payload.supported_to ?? "Final no acreditat"}`
        : "Vigència no delimitada per la font; no es presumeix titularitat actual"}</p>
      <div className="rounded-md bg-amber-50 p-3"><h4 className="font-semibold">Limitacions i què falta confirmar</h4><p className="mt-1 break-words">{p.payload.limitations}</p></div>
      <ul className="space-y-3">{p.payload.evidence.map((e, i) => <li key={i} className="min-w-0 border-t pt-3">
        <p className="break-words">{e.description}</p>
        <p className="text-sm text-muted-foreground">Document: {e.document_date ?? "Sense data explícita d’edició"}{e.page ? ` · Pàgina ${e.page}` : ""} · Consultat: {e.consulted_at}</p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          <a className="underline" href={`/api/entities/pending/${p.registry_number}/proposals/${p.id}/evidence/${i}`} target="_blank" rel="noreferrer">{e.format === "pdf" ? "Obrir PDF arxivat" : "Consultar HTML arxivat com a text"}</a>
          <a className="underline" href={e.url} target="_blank" rel="noreferrer">Consultar font oficial</a>
        </div>
      </li>)}</ul>
      <p className="text-sm text-muted-foreground">Incorporació: {p.recorded_by} · {p.created_at}</p>
    </article>)}
  </section>;
}
