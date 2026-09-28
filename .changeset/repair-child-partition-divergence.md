---
"@secondlayer/cli": minor
---

`repair` now compares local transactions/events row counts against the archive manifest and repairs those ranges on `--apply` even when every block already matches, instead of reporting "nothing to repair." The stale-height hint no longer suggests `bootstrap`, which refuses a database that already holds a completed import.
