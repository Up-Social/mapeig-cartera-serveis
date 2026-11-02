import {assertProcessingEnabled,isProcessingPaused,pauseLocalProcessing,PROCESSING_PAUSE_EXIT_CODE} from '../lib/processing-control';
import {assertLocalMatchingType,assertLocalEnrichmentScope,isLocalTypeBlocked} from '../lib/pipeline/local-matching-guard';
import {beginLocalEnrichment,commitLocalEnrichment,localEnrichmentSnapshot,validateLocalEvidenceOrdinals} from '../lib/pipeline/local-enrichment-commit';
import {ConveniFailure,processConveni} from '../lib/convenis/process';
import {prepareProviderWireRequest,responseModel} from '../lib/openai-model';
import {loadLocalEnrichmentInput} from '../lib/pipeline/local-enrichment-input';
import {ROLE_INSTRUCTIONS} from '../lib/scope-rules';
import {journaledProviderRequest,assertNoUnsettledLocalCalls} from '../lib/provider-journal';
import {validateScopeFacts} from '../lib/normative-matching';
import {bindEnrichmentRoles,enrichmentSchema,sanitize,extractOutputText,type Enrichment} from '../lib/pipeline/enrichment-contract';
import {isEligibleEvidence} from '../lib/evidence-eligibility';
import {hasCurrentTextCoverage} from '../lib/pipeline/document-input';
import {selectEvidenceWindow} from '../lib/cloud/evidence-window';
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const recordId = option("--source-record-id");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MATCHING_MODEL ?? '';
if (!recordId || !url || !key ) throw new Error("Falta el registre o la configuració de Supabase/OpenAI");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: WebSocket as never } });


async function main() {
  await assertProcessingEnabled(supabase);
  const current=await assertLocalEnrichmentScope(supabase,recordId!,process.env.WORKFLOW_JOB_ID || undefined);
  let snapshot:Record<string,unknown>|null=null;
  try {
    await assertNoUnsettledLocalCalls(supabase,current.id);
    if(await processConveni(supabase,current,body=>journaledProviderRequest(supabase,current.id,'conveni',body)))return;
    if(!openaiKey||!model)throw Error('Falta la configuració OpenAI');
    const {record,documents:sourceDocuments,evidence}=await loadLocalEnrichmentInput(supabase,recordId!);
    assertLocalMatchingType(record.financing_type);
    const documents = new Map(sourceDocuments.filter(document=>document.status==='fetched').map(document=>[document.id,document]));
    snapshot=localEnrichmentSnapshot(record,sourceDocuments,evidence);
    await beginLocalEnrichment(supabase,current.id,record.id,snapshot);
    const chunks=selectEvidenceWindow((evidence??[]).filter(chunk=>{
      const document=documents.get(chunk.source_document_id);
      return isEligibleEvidence({content:chunk.content,textLength:document?.text_length,extractionMethod:document?.extraction_method,qualityFlags:document?.quality_flags,coverageVerified:!!document&&hasCurrentTextCoverage(document.extraction_method,document.extraction_coverage,document.mime_type,document.extraction_partial)});
    }));
    if (!chunks.length) {
      if([...documents.values()].some(d=>!hasCurrentTextCoverage(d.extraction_method,d.extraction_coverage,d.mime_type,d.extraction_partial)))throw Error('Cal tornar a verificar la cobertura del text arxivat abans de contrastar les dades.');
      await commitLocalEnrichment(supabase,current.id,record.id,'complete_no_evidence',{extracted_title:null,provider_name:null,provider_nif:null,mechanism:null,award_date:null,amount:null,contracting_body:null,target_population:null,scope_facts:null,summary:'No hi ha evidència oficial llegible i substantiva.',confidence:0,engine:'deterministic-evidence-policy',engine_version:'substantive-evidence-v2'},[],null,snapshot);return;
    }
    const providerRequest={
      model,
      instructions: ROLE_INSTRUCTIONS+" Extreu camps estructurats exclusivament dels fragments dels documents oficials. Usa null quan un camp no hi consti, no completis dades per intuïció i cita els ordinals que sustenten l'extracció. Separa scope_facts: financed_object (objecte finançat), funding_recipient (receptor dels diners), final_recipient (destinatari final) i administrative_role (funció de l’acte); cada valor ha de citar els seus fragments, o ser null. No facis cap matching ni proposis serveis de la Cartera. Respon en català.",
      input: `REGISTRE ORIGINAL (només context)\n${JSON.stringify({ dataset: record.source_dataset, id: record.source_record_id, mechanism: record.mechanism, title: record.title, provider: record.provider_name, amount: record.amount, original: sanitize(record.source_payload) })}\n\nFRAGMENTS OFICIALS\n${chunks.map((chunk, index) => `[${index + 1}] ${chunk.content}`).join("\n\n")}`,
      text: { format: { type: "json_schema", name: "official_enrichment", strict: true, schema: enrichmentSchema() } }, max_output_tokens: 2400,
    };
    const wireHash=prepareProviderWireRequest(providerRequest).fingerprint;
    const raw=await journaledProviderRequest(supabase,current.id,'enrichment',providerRequest);
    const enrichment = bindEnrichmentRoles(JSON.parse(extractOutputText(raw)) as Enrichment,chunks);
    validateScopeFacts(enrichment.scope_facts,chunks.length);
    const awardDate = enrichment.award_date && /^\d{4}-\d{2}-\d{2}$/.test(enrichment.award_date) ? enrichment.award_date : null;
    const citedEvidence = validateLocalEvidenceOrdinals(enrichment.evidence_ordinals,chunks.length).map(ordinal=>chunks[ordinal-1]);
    await commitLocalEnrichment(supabase,current.id,record.id,'complete',{extracted_title:enrichment.title,provider_name:enrichment.provider_name,provider_nif:enrichment.provider_nif,mechanism:enrichment.mechanism,award_date:awardDate,amount:enrichment.amount,contracting_body:enrichment.contracting_body,target_population:enrichment.target_population,scope_facts:enrichment.scope_facts,summary:enrichment.summary,confidence:enrichment.confidence,engine:'openai-responses-enrichment',engine_version:responseModel(raw,model)},citedEvidence.map(chunk=>chunk.id),null,snapshot,{wireHash,response:raw});
    console.log(`${record.source_record_id}: contrast oficial completat`);
  } catch (error) {
    if(isProcessingPaused(error)||isLocalTypeBlocked(error))throw error;
    if(error instanceof Error&&error.message.includes('PROVIDER_UNKNOWN'))throw error;
    if(error instanceof ConveniFailure&&error.code==='STALE_OR_INVALID_CONVENI')throw new Error('LOCAL_TYPE_BLOCKED: La proposta del conveni ja no es pot confirmar. Revisa el lot.');
    const message = formatError(error);
    await commitLocalEnrichment(supabase,current.id,recordId!,'error',null,[],message,snapshot);
    throw new Error(message);
  }
}

function formatError(error: unknown) { if (error instanceof Error) return error.message; if (error && typeof error === "object") { const value = error as Record<string, unknown>; return [value.message,value.details,value.hint,value.code].filter(Boolean).join(" · ") || JSON.stringify(value); } return String(error); }
function option(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
void main().catch(async (error: unknown) => { if(isProcessingPaused(error)){await pauseLocalProcessing(supabase,{jobId:process.env.WORKFLOW_JOB_ID});console.error("PROCESSING_DISABLED");process.exitCode=PROCESSING_PAUSE_EXIT_CODE;return;}console.error("Contrast fallit:", formatError(error)); process.exitCode = 1; });
