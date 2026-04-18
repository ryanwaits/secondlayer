---
"@secondlayer/stacks": minor
"@secondlayer/workflows": patch
"@secondlayer/bundler": patch
---

Workflows v2 — Sprint 2.5: fix `util is not defined` when bundling `step.render` workflows.

**Root cause:** `zod` and `zod/v4` resolve to different physical files in `node_modules`. A user workflow that imports `z` from `zod` alongside internal schemas importing from `zod/v4` produced two Zod copies in the bundled handler; esbuild left the first copy's `util` identifier unscoped.

**Fix:**
- All Stacks atom schemas now import `z` from `zod` (matching the user's natural `import { z } from "zod"`) so the bundler sees one module.
- New `@secondlayer/stacks/ui/schemas` subpath — React-free Zod schemas + a pass-through `defineCatalog` helper. Workflow authors import from `/ui/schemas`; only the dashboard imports `/ui` (which pulls React + `@json-render/react`).
- `step.render` now accepts either a raw `RawCatalogDefinition` (`{ components, actions? }`) or a pre-built `@json-render/core` `Catalog`. The runner wraps raw definitions into a real `Catalog` at render time via its own `@json-render/*` install — keeping json-render entirely out of the user bundle.

**New bundler regression test:** `bundleWorkflowCode` now covers a workflow that imports `defineCatalog` + atom schemas from `@secondlayer/stacks/ui/schemas` and asserts it bundles + evaluates cleanly.

**Runtime dep bump:** `@secondlayer/workflow-runner` moves `@json-render/core` + `@json-render/react` from devDependencies to dependencies so raw catalog definitions can be hydrated.
