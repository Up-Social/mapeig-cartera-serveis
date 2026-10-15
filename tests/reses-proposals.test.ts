import test from "node:test";
import assert from "node:assert/strict";
import {resesProposalArchivePath,resesProposalStatus,type ResesProposal} from "../lib/reses-proposals";
import {resesCsv} from "../lib/reses-csv";

const digest="a".repeat(64);
const proposal:ResesProposal={id:"test",registry_number:"S99003",recorded_by:"Prova",created_at:"2026-10-15",withdrawn:false,
  payload:{source_payload_hash:"source",proposed_name:"Entitat de prova",proposed_nif:"G12345678",role:"documented_provider",
    supported_from:"2024-01-01",supported_to:"2024-12-31",limitations:"Només prova de proveïdor per a 2024; titularitat actual pendent.",
    evidence:[{url:"https://example.org/prova.pdf",description:"Resolució sintètica, no real",document_date:"2024-01-01",consulted_at:"2026-10-15",page:2,format:"pdf",sha256:digest,
      storage_path:`references/reses/S99003/proposals/test-proposals/${digest}.pdf`}]}};
test("documentary identity stays unconfirmed, and later source changes require review",()=>{
  assert.match(resesProposalStatus(proposal,"source"),/no confirmada/);
  assert.match(resesProposalStatus(proposal,"changed"),/tornar a contrastar/);
  assert.match(resesProposalStatus({...proposal,withdrawn:true},"changed"),/retirada/);
});
test("archive access is confined to this registry and content hash",()=>{
  assert.equal(resesProposalArchivePath(proposal,0),proposal.payload.evidence[0].storage_path);
  assert.equal(resesProposalArchivePath(proposal,1),null);
  const altered=structuredClone(proposal);
  altered.payload.evidence[0].storage_path=`cases/other/documents/${digest}.pdf`;
  assert.equal(resesProposalArchivePath(altered,0),null);
  altered.payload.evidence[0].storage_path=`references/reses/S99003/proposals/../${digest}.pdf`;
  assert.equal(resesProposalArchivePath(altered,0),null);
  altered.payload.evidence[0].storage_path=proposal.payload.evidence[0].storage_path.replace(digest,"b".repeat(64));
  assert.equal(resesProposalArchivePath(altered,0),null);
});
test("CSV retains one service per row and separates proposed identities from current holders",()=>{
  const csv=resesCsv([{registry_number:"S99003",source_payload_hash:"source",identity_proposals:[proposal]}, {registry_number:"S99004"}]);
  assert.equal(csv.split("\r\n").length,3);
  assert.match(csv,/NIF proposat/); assert.match(csv,/no confirmada/); assert.match(csv,/Només prova de proveïdor/);
  assert.equal((csv.match(/Titular pendent d’identificar/g)??[]).length,2);
  assert.match(csv,/pàgina 2/);
});
