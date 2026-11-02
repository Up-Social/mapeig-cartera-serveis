/** S1-6 read-only preflight. No apply mode or write-capable database calls.
 * Run: node --import tsx --env-file=.env.local scripts/dry-run-s16-geography.ts
 * Recheck before any future separately authorized write; this is not a receipt. */
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {compareS16Sources,S16_DOCUMENT_SHA,S16_SOURCE_URL,sha} from '../lib/concerts/s16-geography-dry-run';

const PROJECT='vvzxlevbfjvzygorbpxn', RECORD='cf3e157d-d29b-4c01-96ab-42f6e4a04e18',DOCUMENT='0566ccec-3205-4871-8001-3abee31fd070';
const expected=[{id:'45fd04f2-500a-42c6-a0ac-89037b0cd839',reses:'S11621',marker:'EVAMI'},
 {id:'f17be3d5-98dc-4ca7-8645-e4f1a007e82f',reses:'S03685',marker:'ETCA'}] as const;
async function run(){
 if(process.argv.length!==2)throw Error('NO_ARGUMENTS_ALLOWED');
 const projectUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!projectUrl||!key||new URL(projectUrl).origin!==`https://${PROJECT}.supabase.co`)throw Error('PROJECT_NOT_CONFIRMED');
 const db=createClient(projectUrl,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const [record,doc,units,local]=await Promise.all([
  db.from('source_records').select('id,financing_type').eq('id',RECORD).maybeSingle(),
  db.from('source_documents').select('id,source_record_id,storage_path,storage_sha256,status,mime_type,extracted_text,extracted_text_hash,extraction_partial').eq('id',DOCUMENT).eq('source_record_id',RECORD).maybeSingle(),
  db.from('concert_economic_source').select('id,source_record_id,source_fingerprint,document_id,storage_sha256,provider_nif,reses_code,evidence_quote,observed_service_name').in('id',expected.map(x=>x.id)),
  readFile('docs/local/concert-e2e-2026-11-02/S1-6-convocatoria-geografia.html'),
 ]);
 if(record.error||record.data?.financing_type!=='concert'||doc.error||units.error||!doc.data||units.data.length!==2)throw Error('CASE_NOT_AVAILABLE');
 const d=doc.data;
 if(d.status!=='fetched'||d.mime_type!=='application/pdf'||d.extraction_partial!==false||d.storage_sha256!==S16_DOCUMENT_SHA||!d.storage_path||!d.extracted_text||sha(d.extracted_text)!==d.extracted_text_hash||!d.extracted_text.includes('9409'))throw Error('DOCUMENT_NOT_VERIFIED');
 for(const e of expected){const u=units.data.find(x=>x.id===e.id);
  if(!u||u.source_record_id!==RECORD||u.document_id!==DOCUMENT||u.storage_sha256!==S16_DOCUMENT_SHA||u.provider_nif!=='G08973224'||u.reses_code!==e.reses||!String(u.evidence_quote+' '+u.observed_service_name).includes(e.marker)||!u.source_fingerprint)throw Error('UNIT_NOT_VERIFIED');
 }
 const archive=await db.storage.from('cloud-documents').download(d.storage_path);
 if(archive.error||!archive.data||sha(new Uint8Array(await archive.data.arrayBuffer()))!==S16_DOCUMENT_SHA)throw Error('ARCHIVE_HASH_MISMATCH');
 const response=await fetch(S16_SOURCE_URL,{redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.headers.get('content-type')?.toLowerCase().includes('text/html'))throw Error('OFFICIAL_SOURCE_UNAVAILABLE');
 const live=new Uint8Array(await response.arrayBuffer());if(live.length>4_000_000)throw Error('OFFICIAL_SOURCE_TOO_LARGE');
 const source=compareS16Sources(local,live);
 console.log(JSON.stringify({mode:'dry-run-read-only',project:PROJECT,record:RECORD,document:DOCUMENT,documentSha256:S16_DOCUMENT_SHA,
  sourceUrl:S16_SOURCE_URL,sourceCapturedAt:new Date().toISOString(),sourceSha256:sha(live),sourceTextSha256:sha(source.sourceText),
  reference:source.reference,proposals:expected.map(e=>({unit:e.id,reses:e.reses,service:e.marker,municipality:source.reference.municipality,county:source.reference.county,province:source.reference.province,quote:source.quotes[e.marker],economicSourceFingerprint:units.data.find(u=>u.id===e.id)!.source_fingerprint})),
  limitation:'Evidence proposes location only; semantic association and territorial history require review. No data were written or approved.'},null,2));
}
run().catch(error=>{console.error(`S1-6 geography preflight failed: ${error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'PREFLIGHT_UNAVAILABLE'}`);process.exitCode=1;});
