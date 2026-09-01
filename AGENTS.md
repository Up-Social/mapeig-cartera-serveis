<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Mapeig cartera de serveis

Read `docs/PROJECT_CONTEXT.md` before making product, data-model, pipeline, or matching decisions.

Non-negotiable project rules:

- The application stack is TypeScript, Next.js, Supabase and Tailwind CSS.
- The application and Supabase must both run locally for this PoC.
- `Master. Mapeo Cartera Serveis Socials.xlsx` is explicitly authorized for import into the isolated `master_services` reference table. Do not use it to generate, train, tune or silently validate matching results unless the user separately authorizes that use.
- Preserve provenance for every imported row: dataset, original file, sheet, row number and raw payload.
- Matching results are proposals. Keep confidence, evidence and human review separate from source data.
- Database changes go through timestamped migrations. Do not use `supabase db reset` unless the user explicitly authorizes destructive data loss.
- Do not commit secrets or `.env.local`.
- Use Catalan for the product UI and Spanish for user-facing development explanations unless the user asks otherwise.
