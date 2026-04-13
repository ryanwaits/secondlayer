---
"@secondlayer/web": minor
---

Chat can now scaffold → deploy workflows end-to-end without leaving the session:

- New session tools: `scaffold_workflow` (typed trigger + steps → compilable source), `deploy_workflow` (HIL deploy card), and `list_workflow_templates` (gallery over the six `@secondlayer/workflows/templates` seeds).
- New `POST /api/sessions/bundle-workflow` route that session-auths and bundles via `@secondlayer/bundler`, returning typed `BundleSizeError` payloads on overflow.
- The deploy action card bundles server-side, persists via `POST /api/workflows` with `x-sl-origin: session`, and surfaces bundler errors inline. On success it renders a follow-up card with **Trigger test run** and **Tail live runs** CTAs; the first test-run reuses the deploy click as consent and fires directly against `/api/workflows/:name/trigger` (tail wiring lands in Sprint 5).
- Session instructions now describe the scaffold → deploy loop, list the six seed templates, and enforce the in-flight-run caveat on every confirm message.
