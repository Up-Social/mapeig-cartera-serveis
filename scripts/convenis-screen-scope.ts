/**
 * Batch scope screening of Convenis from the Excel row. No document is read,
 * no model is called and no worker task is created.
 *
 *   tsx scripts/convenis-screen-scope.ts --input candidates.json            (dry run: counts)
 *   tsx scripts/convenis-screen-scope.ts --input candidates.json --sql out.sql
 *
 * `candidates.json` is the JSON output of a read-only query returning rows
 * {id,source_record_id,title,source_payload} for convenis without any job,
 * human decision, provision, override or task. The generated SQL creates one
 * run, re-checks those conditions per record at apply time, and screens each
 * record in its own subtransaction through screen_conveni_v2, which re-checks
 * the rule invariant. Records that no rule screens are left untouched.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {CONVENI_SCOPE_VERSION,screenConveniScope} from '../lib/convenis/scope';

type Candidate={id:string;source_record_id:string;title:string;source_payload:Record<string,unknown>};
const arg=(name:string)=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;};
const input=arg('--input');const out=arg('--sql');
if(!input)throw Error('--input required');
const raw=readFileSync(input,'utf8');
const parsed=JSON.parse(raw.slice(raw.indexOf('{')));
const rows=(Array.isArray(parsed)?parsed:parsed.rows) as Candidate[];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const quote=(value:string)=>`'${value.replace(/'/g,"''")}'`;

const screened=rows.flatMap(row=>{
 if(!uuid.test(row.id))throw Error(`Invalid id ${row.id}`);
 const proposal=screenConveniScope(row.title??'',row.source_payload??{});
 return proposal?[{row,proposal}]:[];
});
const counts:Record<string,number>={};
for(const {proposal} of screened)counts[`${proposal.rule} (${proposal.mode})`]=(counts[`${proposal.rule} (${proposal.mode})`]??0)+1;
console.log(JSON.stringify({candidates:rows.length,screened:screened.length,unscreened:rows.length-screened.length,byRule:counts,version:CONVENI_SCOPE_VERSION},null,1));

if(out){
 const lines=[
  'BEGIN;',"SET LOCAL statement_timeout = '300s';",
  'CREATE TEMP TABLE scope_batch_result(record uuid,outcome text) ON COMMIT DROP;',
  `CREATE TEMP TABLE scope_batch_run ON COMMIT DROP AS WITH r AS (INSERT INTO public.pipeline_runs(status,stage,selected_count,parameters) VALUES('queued','review',0,jsonb_build_object('purpose','conveni_scope_screening','auto_process',false,'scope_version',${quote(CONVENI_SCOPE_VERSION)})) RETURNING id) SELECT id FROM r;`,
 ];
 for(const {row,proposal} of screened){
  lines.push(`DO $r$ DECLARE jid uuid; BEGIN
 IF EXISTS(SELECT 1 FROM public.pipeline_jobs WHERE source_record_id=${quote(row.id)})
  OR EXISTS(SELECT 1 FROM public.review_decisions WHERE source_record_id=${quote(row.id)})
  OR EXISTS(SELECT 1 FROM public.service_provisions WHERE source_record_id=${quote(row.id)} AND superseded_at IS NULL)
  OR EXISTS(SELECT 1 FROM public.conveni_scope_overrides WHERE source_record_id=${quote(row.id)})
  OR EXISTS(SELECT 1 FROM public.worker_tasks WHERE source_record_id=${quote(row.id)})
 THEN INSERT INTO scope_batch_result VALUES(${quote(row.id)},'skipped:changed');RETURN;END IF;
 INSERT INTO public.pipeline_jobs(run_id,source_record_id,status,preparation_status,enrichment_status)
  SELECT id,${quote(row.id)},'selected','pending','pending' FROM scope_batch_run RETURNING id INTO jid;
 IF NOT public.screen_conveni_v2(jid,${quote(proposal.reason)},${quote(proposal.rule)},${quote(proposal.version)},${quote(proposal.mode)},${quote(proposal.explanation)}) THEN RAISE EXCEPTION 'NOT_SCREENED';END IF;
 INSERT INTO scope_batch_result VALUES(${quote(row.id)},${quote(`${proposal.rule}:${proposal.mode}`)});
EXCEPTION WHEN OTHERS THEN INSERT INTO scope_batch_result VALUES(${quote(row.id)},'failed:'||SQLERRM);
END $r$;`);
 }
 lines.push(
  'SELECT public.refresh_pipeline_run(id) FROM scope_batch_run;',
  'DELETE FROM public.pipeline_runs WHERE id IN (SELECT id FROM scope_batch_run) AND NOT EXISTS(SELECT 1 FROM public.pipeline_jobs j WHERE j.run_id=pipeline_runs.id);',
  'SELECT (SELECT id FROM scope_batch_run) AS run_id,outcome,count(*) FROM scope_batch_result GROUP BY outcome ORDER BY outcome;',
  'COMMIT;',
 );
 writeFileSync(out,lines.join('\n')+'\n');
 console.log(`SQL written to ${out}`);
}
