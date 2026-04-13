---
"@secondlayer/web": minor
---

Subgraph chat authoring loop — web surface.

- New session tools: `deploy_subgraph` (HIL), `read_subgraph`, `edit_subgraph` (HIL), `tail_subgraph_sync`. Agents can now scaffold → customize → deploy → read → edit → tail subgraphs end-to-end from chat, mirroring the workflows loop.
- New proxy routes `/api/sessions/bundle-subgraph` and `/api/sessions/diff-subgraph` pass bundle + diff work through to the Hetzner API's server-side bundler.
- Shared `buildUnifiedDiff()` helper in `lib/sessions/diff.ts` backs both the workflow and subgraph edit flows; `diff-workflow.ts` is now a thin re-export for backward compatibility.
- New cards `DeploySubgraphCard` and `SubgraphSyncLive` (2s polling against `GET /api/subgraphs/:name` until catch-up, 10-minute ceiling).
- `tool-part-renderer.tsx` wires the new HIL set members, input-available cards, output-available renderers, and a `bundleAndDeploySubgraph()` helper.
- System prompt (`lib/sessions/instructions.ts`) gains Subgraph authoring and Subgraph edit loop sections — teaches the agent to pause after scaffold, always read before editing, and warn users when schema changes will trigger a reindex. Explicitly notes that subgraph edits don't yet have stale-write protection.
- `platform/subgraphs/[name]/page.tsx` gets an "Open in chat" CTA mirroring the workflows dashboard button; a new session is seeded with a prompt asking the agent to read the subgraph's source.
