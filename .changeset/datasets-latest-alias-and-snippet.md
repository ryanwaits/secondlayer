---
"@secondlayer/indexer": patch
---

Datasets publisher now writes `latest.json` to the family-root alias path (`<prefix>/<dataset>/latest.json`) in addition to `<prefix>/<dataset>/manifest/latest.json`. Quickstart snippets that say "latest.json per family" — the intuitive URL — now work without rewriting docs. Marketing parquet snippet (`apps/web` parquet-snippet component) updated to a manifest-based DuckDB query (recommended, no LIST permission needed) plus a glob fallback with `SET allow_asterisks_in_http_paths = true`; the previously documented glob-only quickstart failed on the R2 dev domain.
