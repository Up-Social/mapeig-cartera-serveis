import {withWorkflow} from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.WORKFLOW_BUILD_ISOLATED==='true'?'.next-workflow-build':'.next',
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
    ] }];
  },
};

export default withWorkflow(nextConfig);
