import {resesProposalRole, resesProposalStatus, type ResesProposal} from "./reses-proposals";

export function resesCsv(rows: Array<Record<string, unknown>>): string {
  const keys = ["registry_number","service_name","service_type","municipality","county","capacity","address","active","source_payload_hash"];
  const cell = (value: unknown) => {
    const s = value == null ? "" : String(value);
    return `"${(/^[=+\-@\t\r]/.test(s) ? "'"+s : s).replaceAll('"','""')}"`;
  };
  return "\uFEFF" + [
    ["RESES","Servei","Tipologia","Municipi","Comarca","Capacitat","Adreça","Actiu","SHA-256 de la font","Titularitat","Entitat proposada","NIF proposat","Rol documentat","Estat de la proposta","Limitacions","Fonts i pàgines"].map(cell).join(";"),
    ...rows.map(row=>{
      const proposals=(row.identity_proposals??[]) as ResesProposal[];
      const joined=(read:(p:ResesProposal)=>string)=>proposals.map(read).join(" | ");
      return [...keys.map(key=>row[key]),"Titular pendent d’identificar",joined(p=>p.payload.proposed_name),joined(p=>p.payload.proposed_nif),
        joined(p=>resesProposalRole(p.payload.role)),joined(p=>resesProposalStatus(p,String(row.source_payload_hash))),joined(p=>p.payload.limitations),
        joined(p=>p.payload.evidence.map(e=>`${e.url}${e.page?` · pàgina ${e.page}`:""}`).join(" | "))].map(cell).join(";");
    }),
  ].join("\r\n");
}
