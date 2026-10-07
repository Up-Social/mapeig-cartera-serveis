import {withWorkflow} from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.WORKFLOW_TEST_E2E==='true'?'.cache/next-workflow-e2e':process.env.WORKFLOW_BUILD_ISOLATED==='true'?'.cache/next-workflow-build':'.next',
  // Keep local validation from spawning a worker per available CPU.
  ...(process.env.WORKFLOW_BUILD_ISOLATED==='true'?{experimental:{cpus:1}}:{}),
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
    ] },
    {source:'/api/documents/:id/open',headers:[{key:'Content-Security-Policy',value:"sandbox; default-src 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"}]},
    {source:'/api/records/:id/units/:unitId/source',headers:[{key:'Content-Security-Policy',value:"sandbox; default-src 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"}]}
    ];
  },
};

// Disabled development flows need no Workflow compiler/watchers. Production
// builds still include the plugin so their validation remains representative.
const skipWorkflow = process.env.LOCAL_REMOTE_PREVIEW === 'true'
  || (process.env.NODE_ENV === 'development' && process.env.WORKER_EXECUTION_MODE === 'disabled');
export default skipWorkflow ? nextConfig : withWorkflow(nextConfig);
