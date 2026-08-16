---
"@secondlayer/shared": patch
---

Add the `archive_fetches` table (migration 0121) — the charge log for the archive fetch gate — and register it in `table-plane.ts` as a control-plane table.
