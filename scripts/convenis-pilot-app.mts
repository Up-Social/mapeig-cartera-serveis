import {execFileSync} from 'node:child_process';
import {runManagedProcess} from './managed-process';
import {PILOT_API,PILOT_PROJECT,assertPilotTarget} from '../lib/convenis/pilot-budget';
const status=JSON.parse(execFileSync('supabase',['status','--workdir','.cache/convenis-pilot-runtime','-o','json'],{encoding:'utf8',stdio:['pipe','pipe','pipe']}));
assertPilotTarget(status.API_URL,PILOT_PROJECT);
const env:NodeJS.ProcessEnv={...process.env,NEXT_PUBLIC_SUPABASE_URL:PILOT_API,SUPABASE_SECRET_KEY:status.SERVICE_ROLE_KEY,SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY,APP_ACCESS_PASSWORD:'local-convenis-pilot-review',APP_ACCESS_SESSION_SECRET:'local-convenis-pilot-review',WORKER_EXECUTION_MODE:'disabled',MATCHING_CATALOG_SOURCE:'official',OPENAI_API_KEY:'',VERCEL_TOKEN:'',SUPABASE_ACCESS_TOKEN:'',WORKFLOW_BUILD_ISOLATED:'true'};
delete env.WORKFLOW_TEST_PROJECT;delete env.WORKFLOW_TEST_E2E;
runManagedProcess(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3118'],{env,stdio:'inherit'});
