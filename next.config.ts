import {withWorkflow} from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.WORKFLOW_BUILD_ISOLATED==='true'?'.next-workflow-build':'.next',
  allowedDevOrigins: ["127.0.0.1"],
};

export default withWorkflow(nextConfig);
