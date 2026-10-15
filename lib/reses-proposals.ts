export type ResesProposal = {
  id: string; registry_number: string; recorded_by: string; created_at: string; withdrawn: boolean;
  payload: {
    source_payload_hash: string; proposed_name: string; proposed_nif: string;
    role: "documented_provider" | "public_responsibility";
    supported_from: string | null; supported_to: string | null; limitations: string;
    evidence: Array<{url: string; description: string; document_date: string | null; consulted_at: string;
      page?: number; format: "pdf" | "html"; sha256: string; storage_path: string}>;
  };
};
export function resesProposalRole(role: ResesProposal["payload"]["role"]) {
  return role === "documented_provider" ? "Proveïdor documentat" : "Ens públic responsable";
}
export function resesProposalStatus(proposal: ResesProposal, sourceHash: string) {
  if (proposal.withdrawn) return "Proposta retirada · historial conservat";
  if (proposal.payload.source_payload_hash !== sourceHash) return "Font RESES actualitzada · cal tornar a contrastar la proposta";
  return "Proposta documentada · titularitat actual no confirmada";
}
export function resesProposalArchivePath(proposal: ResesProposal, index: number) {
  const e = proposal.payload.evidence[index];
  if (!e || !/^[a-f0-9]{64}$/.test(e.sha256) || !["pdf", "html"].includes(e.format)) return null;
  const prefix = `references/reses/${proposal.registry_number}/proposals/`;
  const suffix = e.storage_path.slice(prefix.length);
  return e.storage_path.startsWith(prefix) && /^[a-z0-9-]{8,100}\/[a-f0-9]{64}\.(pdf|html)$/.test(suffix)
    && suffix.endsWith(`/${e.sha256}.${e.format}`) ? e.storage_path : null;
}
