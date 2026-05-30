---
"@secondlayer/shared": minor
"@secondlayer/api": minor
"@secondlayer/indexer": minor
---

Add a wrong/empty Postgres volume guard. `checkChainDataIntegrity` flags the case where the chain tip is high but the deep history it implies is missing — the signature of a container recreated against a fresh/empty data dir. The indexer logs a loud `DB INTEGRITY ALERT` on startup (fail-closed with `REQUIRE_INTEGRITY=true`), and `/public/status` now reports `chainIntegrity` and degrades the top-level status on failure (without marking a core service down). Closes the blind spot where the DB read "healthy" on freshness while serving an empty volume.
