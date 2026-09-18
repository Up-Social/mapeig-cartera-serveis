import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {assertTestEnvironment,TEST_PROJECT} from '../lib/test-environment';
const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
assertTestEnvironment({NEXT_PUBLIC_SUPABASE_URL:status.API_URL,WORKFLOW_TEST_PROJECT:TEST_PROJECT,PIPELINE_PROVIDER:'mock'});
for(const file of readdirSync('tests/sql').filter(f=>f.endsWith('.sql')).sort()){
 execFileSync('docker',['exec','-i',`supabase_db_${TEST_PROJECT}`,'psql','-U','postgres','-X','-v','ON_ERROR_STOP=1'],{input:`begin;\n${readFileSync(`tests/sql/${file}`,'utf8')}\nrollback;`,stdio:['pipe','pipe','pipe']});
 console.log(`PASS ${file} (rolled back)`);
}
