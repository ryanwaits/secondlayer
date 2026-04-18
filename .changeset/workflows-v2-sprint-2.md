---
"@secondlayer/workflows": minor
"@secondlayer/stacks": minor
"@secondlayer/web": patch
---

Workflows v2 — Sprint 2: json-render integration + Stacks UI atoms.

**New step primitive:**
- `step.render(id, catalog, { model, prompt, system?, context? })` — AI generates a json-render catalog-validated spec. Runner derives a Zod schema from `catalog.zodSchema()`, passes it to AI SDK `generateObject`, validates the result with `catalog.validate()`, and returns `{ spec, usage }`.

**Stacks UI pillar (`@secondlayer/stacks/ui`):**
- 8 atom components: `Address`, `Amount`, `TxStatus`, `Principal`, `BnsName`, `NftAsset`, `BlockHeight`, `Token`
- Each atom exports `{ props: ZodType, render: React.FC }` for use in both json-render catalogs and direct React rendering
- `defineCatalog` + `schema` re-exported from `@json-render/*` so authors only import from one place
- `atoms` registry + `atomComponentMap` helper for `createRenderer()` dashboard wiring

**Dashboard:**
- Workflow run detail (`apps/web/src/app/platform/workflows/[name]/runs/[runId]/page.tsx`) now dispatches on `stepType === "render"` — uses `<WorkflowRenderOutput>` client component (json-render `createRenderer` with Stacks atoms) instead of raw JSON `<pre>`. Unknown component types fall through to the raw output.
- New step type colors: `render`, `generateObject`, `generateText`, `tool`.

**Package plumbing:**
- `@secondlayer/stacks` adopts JSX (`tsconfig.json: "jsx": "react-jsx"`) and exposes a new `./ui` bunup entry + package subpath export
- `@json-render/core` + `@json-render/react` added as optional peer dependencies of both `@secondlayer/stacks` and `@secondlayer/workflows`

**Known limitation (deferred to a later sprint):** bundling a user workflow that imports `@secondlayer/stacks/ui` directly can produce duplicate Zod copies whose second pass references a bare `util` identifier esbuild doesn't re-scope, causing `Module evaluation failed: util is not defined` at deploy-time. Workaround: keep catalog definitions outside the bundled handler (inline Zod schemas only) until the bundler is taught to dedupe the nested copies or json-render publishes an unbundled entry.
