import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {assertTestEnvironment,TEST_PROJECT} from '../lib/test-environment';
import {requireCleanPrototypeSchema} from './sql-test-prototype-guard';
const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
assertTestEnvironment({NEXT_PUBLIC_SUPABASE_URL:status.API_URL,WORKFLOW_TEST_PROJECT:TEST_PROJECT,PIPELINE_PROVIDER:'mock'});
execFileSync('docker',['exec','-i',`supabase_db_${TEST_PROJECT}`,'psql','-U','postgres','-X','-v','ON_ERROR_STOP=1'],{input:requireCleanPrototypeSchema,stdio:['pipe','pipe','pipe']});
const experimental=new Set(['75-local-matching-equivalent-guard.sql','77-local-matching-group-reservation.sql','79-batch-export-snapshot.sql','81-batch-export-checked.sql']);
const onlyExperiments=process.argv.includes('--experiments');
const experimentFiles=onlyExperiments?readdirSync('supabase/experiments/migrations').filter(f=>f.endsWith('.sql')).sort():[];
if(onlyExperiments&&experimentFiles.map(f=>f.slice(0,14)).join(',')!=='20261029031000,20261029032000,20261029033000,20261029034000')throw Error('Unexpected experimental migration inventory');
const experimentalMigrations=experimentFiles.map(f=>readFileSync(`supabase/experiments/migrations/${f}`,'utf8')).join('\n');
for(const file of readdirSync('tests/sql').filter(f=>f.endsWith('.sql') && experimental.has(f)===onlyExperiments).sort()){
 let fixture='';
 if(file==='97-discard-review-history.sql'){
  const parts=readFileSync('tests/sql/07-delete.sql','utf8').split('do $$\ndeclare a jsonb;');
  if(parts.length!==2)throw Error('Discard fixture boundary changed');
  fixture=parts[0];
 }
 execFileSync('docker',['exec','-i',`supabase_db_${TEST_PROJECT}`,'psql','-U','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`begin;\n${experimentalMigrations}\n${fixture}\n${readFileSync(`tests/sql/${file}`,'utf8')}\nrollback;`,stdio:['pipe','pipe','pipe']});
 console.log(`PASS ${file} (rolled back)`);
}
