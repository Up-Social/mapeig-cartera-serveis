import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSafeEvidenceRecovery,
  assertSafeRequestVersion,
  assertSafeLegacyAuditReceipts,
  ANALYSIS_EVIDENCE_LIMIT,
  selectEvidenceWindow,
} from "../lib/cloud/evidence-window";
import {CloudFailure} from '../lib/cloud/errors';
import {hasCurrentTextCoverage} from '../lib/pipeline/document-input';
import {isEligibleEvidence} from '../lib/evidence-eligibility';
import {buildNormativeInput,MATCHING_INSTRUCTIONS} from '../lib/normative-matching';
import {prepareProviderWireRequest} from '../lib/openai-model';

test('the new matching policy does not reuse a request pinned to the prior contract',()=>{
 const input=JSON.parse(buildNormativeInput({},[],[],'',[]));
 const body={model:'synthetic',instructions:MATCHING_INSTRUCTIONS,input:JSON.stringify(input)};
 const old={...body,input:JSON.stringify({...input,matching_contract_version:'matching-catalog-priority-v3'})};
 const prior=prepareProviderWireRequest(old).fingerprint,current=prepareProviderWireRequest(body).fingerprint;
 assert.notEqual(prior,current);
 assert.throws(()=>assertSafeRequestVersion(prior,current,'received','matching_input'),(e:unknown)=>e instanceof CloudFailure&&e.diagnostic?.code==='NEW_ANALYSIS_REQUIRED');
 assert.throws(()=>assertSafeRequestVersion(prior,current,'sending','matching_input'),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_unknown');
});

test('partial PDF without quality flags is excluded and invalidates previously pinned or received evidence',()=>{
 const content='Document oficial del servei social amb descripció substantiva i dades de la resolució. '.repeat(12);
 const partial={method:'pdf-text-markdown-v2',coverage:{complete:false},mime:'application/pdf',partial:true};
 const complete={...partial,coverage:{complete:true},partial:false};
 const isCovered=(doc:typeof partial)=>hasCurrentTextCoverage(doc.method,doc.coverage,doc.mime,doc.partial);
 assert.equal(isEligibleEvidence({content,textLength:content.length,qualityFlags:[],coverageVerified:isCovered(partial)}),false);
 assert.equal(isEligibleEvidence({content,textLength:content.length,qualityFlags:[],coverageVerified:isCovered(complete)}),true);
 const item={source_document_id:'partial-pdf',ordinal:1,content};
 for(const [state,pinned] of [['received',null],[undefined,[item]]] as const)
  assert.throws(()=>assertSafeEvidenceRecovery(state,pinned,[item],()=>isCovered(partial)),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='NEW_ANALYSIS_REQUIRED');
 assert.throws(()=>assertSafeEvidenceRecovery('sending',[item],[item],()=>isCovered(partial)),(error:unknown)=>error instanceof CloudFailure&&error.kind==='provider_unknown');
});

test('uncertain provider calls and changed evidence never proceed to a fallback or replay',()=>{
 const item={source_document_id:'doc',ordinal:1,content:'fragment'};
 assert.throws(()=>assertSafeEvidenceRecovery('sending',null,[],()=>false),(error:unknown)=>error instanceof CloudFailure&&error.kind==='provider_unknown');
 assert.throws(()=>assertSafeEvidenceRecovery('unknown',null,[],()=>true),(error:unknown)=>error instanceof CloudFailure&&error.kind==='provider_unknown');
 assert.throws(()=>assertSafeEvidenceRecovery('received',null,[item],()=>false),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='NEW_ANALYSIS_REQUIRED');
 assert.throws(()=>assertSafeEvidenceRecovery(undefined,[item],[item],()=>false),(error:unknown)=>error instanceof CloudFailure&&error.diagnostic?.code==='NEW_ANALYSIS_REQUIRED');
 assert.doesNotThrow(()=>assertSafeEvidenceRecovery('received',[item],[item],()=>true));
 assert.doesNotThrow(()=>assertSafeEvidenceRecovery(undefined,null,[item],()=>false));
});
test('a conveni receipt cannot be replayed with a changed or missing input contract',()=>{
 assert.doesNotThrow(()=>assertSafeRequestVersion(null,'new',undefined));
 assert.doesNotThrow(()=>assertSafeRequestVersion('same','same','received'));
 assert.throws(()=>assertSafeRequestVersion('old','new','received'),(e:unknown)=>e instanceof CloudFailure&&e.diagnostic?.code==='NEW_ANALYSIS_REQUIRED');
 assert.throws(()=>assertSafeRequestVersion(null,'new','received'),(e:unknown)=>e instanceof CloudFailure&&e.diagnostic?.code==='NEW_ANALYSIS_REQUIRED');
 assert.throws(()=>assertSafeRequestVersion('old','new','sending'),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_unknown');
 assert.throws(()=>assertSafeRequestVersion('same','same','unknown'),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_unknown');
});
test('an older audit receipt cannot silently trigger a new paid audit',()=>{
 assert.throws(()=>assertSafeLegacyAuditReceipts(['sending'],undefined),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_unknown');
 assert.throws(()=>assertSafeLegacyAuditReceipts(['unknown'],undefined),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_unknown');
 assert.throws(()=>assertSafeLegacyAuditReceipts([],'unknown'),(e:unknown)=>e instanceof CloudFailure&&e.kind==='provider_unknown');
 assert.throws(()=>assertSafeLegacyAuditReceipts(['received'],undefined),(e:unknown)=>e instanceof CloudFailure&&e.diagnostic?.code==='NEW_ANALYSIS_REQUIRED');
 assert.doesNotThrow(()=>assertSafeLegacyAuditReceipts(['received'],'received'));
 assert.doesNotThrow(()=>assertSafeLegacyAuditReceipts([],undefined));
});

function chunks(document: string, count: number) {
  return Array.from({ length: count }, (_, ordinal) => ({
    source_document_id: document,
    ordinal,
    content: `${document}-${ordinal}`,
  }));
}

test("keeps the resolution opening and the final annex within the evidence budget", () => {
  const selected = selectEvidenceWindow(chunks("official-pdf", 14));

  assert.equal(selected.length, ANALYSIS_EVIDENCE_LIMIT);
  assert.deepEqual(
    selected.map((chunk) => chunk.ordinal),
    [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13],
  );
});

test("preserves the beginning and end of every document and their original order", () => {
  const input = [...chunks("document-a", 8), ...chunks("document-b", 8)];
  const selected = selectEvidenceWindow(input, 8);

  assert.deepEqual(
    selected.map((chunk) => chunk.content),
    [
      "document-a-0",
      "document-a-1",
      "document-a-6",
      "document-a-7",
      "document-b-0",
      "document-b-1",
      "document-b-6",
      "document-b-7",
    ],
  );
});

test("does not reorder or truncate evidence that already fits", () => {
  const input = chunks("short-document", 3);
  assert.deepEqual(selectEvidenceWindow(input), input);
});

test('a task with any uncertain provider receipt cannot finish or switch paths',async()=>{
 const {assertNoUnsettledProviderReceipts}=await import('../lib/cloud/evidence-window');
 const db=(data:unknown[],error:Error|null=null)=>({from(){const q={select(){return q;},eq(){return q;},like(){return q;},contains(){return q;},limit(){return Promise.resolve({data,error});}};return q;}});
 await assert.rejects(assertNoUnsettledProviderReceipts(db([{item_key:'ai:job:role'}]) as never,'task'),(error:unknown)=>error instanceof CloudFailure&&error.kind==='provider_unknown');
 await assert.rejects(assertNoUnsettledProviderReceipts(db([],Error('offline')) as never,'task'),(error:unknown)=>error instanceof CloudFailure&&error.kind==='internal');
 await assert.doesNotReject(assertNoUnsettledProviderReceipts(db([]) as never,'task'));
});
