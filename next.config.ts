import {withWorkflow} from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
};

export default withWorkflow(nextConfig);
