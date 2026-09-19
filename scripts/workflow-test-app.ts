import {execFileSync,spawn} from 'node:child_process';
import {assertTestEnvironment,TEST_PROJECT} from '../lib/test-environment';
const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
const env={...process.env,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY:status.SERVICE_ROLE_KEY,WORKFLOW_TEST_PROJECT:TEST_PROJECT,PIPELINE_PROVIDER:'mock',WORKER_EXECUTION_MODE:'disabled',MATCHING_CATALOG_SOURCE:'official',APP_ACCESS_PASSWORD:'local-workflow-fixture-only',OPENAI_API_KEY:'',VERCEL_TOKEN:'',SUPABASE_ACCESS_TOKEN:''};
assertTestEnvironment(env);
const child=spawn('node',['node_modules/next/dist/bin/next','dev','--webpack','-p','3108','-H','127.0.0.1'],{env,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>child.kill(signal));
