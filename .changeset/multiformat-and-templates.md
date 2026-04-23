---
"@secondlayer/subgraphs": minor
"@secondlayer/cli": minor
---

Multi-format dispatch + `sl create subscription` scaffolder.

- `@secondlayer/subgraphs`: 5 new format builders — Inngest events API, Trigger.dev v3 task trigger, Cloudflare Workflows, CloudEvents 1.0 structured JSON, and raw. The emitter dispatches on `subscription.format`; unknown values fall back to `standard-webhooks` with a warning log.
- `@secondlayer/cli`: `sl create subscription <name> --runtime <inngest|trigger|cloudflare|node>` scaffolds a runtime-specific receiver project (package.json + src + README + tsconfig), then provisions the subscription via the SDK and writes the one-time signing secret into `.env`. Templates live at `packages/cli/templates/subscriptions/<runtime>/` and ship in the npm tarball.
