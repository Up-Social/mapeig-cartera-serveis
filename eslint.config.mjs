import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["lib/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "scripts/**/*.ts"],
    ignores: ["lib/cloud/sandbox.ts", "lib/cloud/sandbox-inventory.ts", "scripts/prepare-cloud-sandbox.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "@vercel/sandbox", message: "Use the ephemeral lifecycle adapter; only the inventory and explicit base-image builder may access the SDK directly." }] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-workflow-build/**",
    ".cache/**",
    "docs/local/**",
    "playwright-report/**",
    "test-results/**",
    "app/.well-known/workflow/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "supabase/.temp/**",
  ]),
]);

export default eslintConfig;
