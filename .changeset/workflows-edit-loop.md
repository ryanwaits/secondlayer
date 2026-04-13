---
"@secondlayer/web": minor
"@secondlayer/api": patch
"@secondlayer/mcp": minor
---

Read / edit / diff loop for workflows:

- Web: new session tools `read_workflow` (fetches stored source + version via `/api/workflows/:name/source`, graceful read-only fallback) and `edit_workflow` (HIL with diff card). A new `DiffCard` component renders server-rendered unified diff hunks; a companion `POST /api/sessions/diff-workflow` route pre-computes hunks via the `diff` package and shiki. Confirming the edit reuses the Sprint 3 bundle + deploy path with `expectedVersion`, surfaces 409s as "Stale vX.Y.Z" on the card, and the session instructions now enforce read → edit → confirm with the in-flight-run caveat.
- API: `POST /api/workflows` now deletes any lingering `workflow_schedules` row when a workflow edit moves the trigger off `schedule`, so the cron worker stops firing the old schedule.
- MCP: new `workflows_propose_edit` tool — fetches the deployed source, bundles the proposed source for validation only (no deploy), and returns `{ currentVersion, currentSource, proposedSource, diffText, bundleValid, validation, bundleSize }` so external agents can present a diff without committing.
