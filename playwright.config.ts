import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
 testDir:'./tests/e2e',
 fullyParallel:false,
 timeout:90_000,
 workers:1,
 retries:0,
 reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://127.0.0.1:3112',trace:'retain-on-failure',screenshot:'only-on-failure'},
 // Let the managed launcher terminate its own child group before Playwright
 // escalates. The default SIGKILL bypasses cleanup and leaves Next orphaned.
 webServer:{command:'WORKFLOW_TEST_E2E=true WORKFLOW_TEST_PORT=3112 node --import tsx scripts/workflow-test-app.ts',url:'http://127.0.0.1:3112/login',reuseExistingServer:false,timeout:120_000,gracefulShutdown:{signal:'SIGTERM',timeout:5000}},
 projects:[
  {name:'desktop',use:{...devices['Desktop Chrome']}},
  {name:'mobile',use:{...devices['iPhone 13'],browserName:'chromium'}},
 ],
});
