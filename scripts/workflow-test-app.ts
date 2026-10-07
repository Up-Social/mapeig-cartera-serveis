import {execFileSync} from 'node:child_process';
import {runManagedProcess} from './managed-process';
import {assertTestEnvironment,TEST_PROJECT} from '../lib/test-environment';
const status=JSON.parse(execFileSync('supabase',['status','--workdir','tests/runtime','-o','json'],{encoding:'utf8'}));
const port=process.env.WORKFLOW_TEST_PORT??'3108';
const env: NodeJS.ProcessEnv={...process.env,NEXT_PUBLIC_SUPABASE_URL:status.API_URL,SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY:status.SERVICE_ROLE_KEY,WORKFLOW_TEST_PROJECT:TEST_PROJECT,PIPELINE_PROVIDER:'mock',WORKER_EXECUTION_MODE:'disabled',WATCHPACK_WATCHER_LIMIT:'20',MATCHING_CATALOG_SOURCE:'official',OPENAI_API_KEY:'',VERCEL_TOKEN:'',SUPABASE_ACCESS_TOKEN:''};
if(process.env.WORKFLOW_TEST_E2E==='true'){env.APP_ACCESS_PASSWORD='local-workflow-fixture-only';env.APP_ACCESS_SESSION_SECRET='local-workflow-fixture-only';}else delete env.APP_ACCESS_PASSWORD;
assertTestEnvironment(env);
runManagedProcess(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','-p',port,'-H','127.0.0.1'],{env,stdio:'inherit'});
