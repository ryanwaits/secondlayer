---
"@secondlayer/scaffold": minor
"@secondlayer/web": minor
---

Stream chat authoring loop.

- **scaffold**: new `generateStreamConfig()` + `StreamFilter` / `CreateStream` / `StreamOptions` type re-exports. Takes `{ name, endpointUrl, filters, options? }`, merges delivery defaults, and returns a validated CreateStream payload. Covered by 9 fixture tests against the real `CreateStreamSchema` from `@secondlayer/shared`.
- **web**: 6 new session tools — `scaffold_stream`, `deploy_stream` (HIL), `read_stream`, `edit_stream` (HIL), `tail_deliveries`, and `list_stream_filter_types`. The filter catalogue is an on-demand tool (not in the system prompt) so token cost stays bounded.
- **web**: new cards `StreamConfigCard` (reused for scaffold + read), `DeployStreamCard`, `ConfigDiffCard` (structural filter diff, not line-based), `DeliveriesTailCard` (3s polling against `/api/streams/:id/deliveries`). `tool-part-renderer` gains input/output cases, a `deployStreamConfig()` helper, and `EditStreamCardWrapper` that PATCHes `/api/streams/:id` on confirm.
- **web**: deploy success surfaces the one-time **signing secret** in the output card — the instructions reinforce that the user must copy it immediately.
- **web**: system prompt (`instructions.ts`) gains "Stream authoring" and "Stream edit loop" sections. The agent is told to call `list_stream_filter_types` on demand instead of inline filter enumeration.
- **web**: `platform/streams/[id]/page.tsx` gets an "Open in chat" CTA seeding a new session with `Read stream "<name>" …`.
