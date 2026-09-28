import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
 testDir:'./tests/e2e',
 fullyParallel:false,
 workers:1,
 retries:0,
 reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://localhost:3108',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'npm run test:app',url:'http://localhost:3108/login',reuseExistingServer:false,timeout:120_000},
 projects:[
  {name:'desktop',use:{...devices['Desktop Chrome']}},
  {name:'mobile',use:{...devices['iPhone 13'],browserName:'chromium'}},
 ],
});
