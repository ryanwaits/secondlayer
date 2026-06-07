---
"@secondlayer/indexer": patch
"@secondlayer/cli": patch
---

Remove the platform's Hiro reliance. The integrity auto-backfill no longer falls back to Hiro's public API for gaps the own DB can't replay (Phase 1 own-stacks-node DB replay stays; unfillable gaps now alert loudly instead of silently calling `api.mainnet.hiro.so`) — the running plane is now Hiro-free. Drop the `api.hiro.so` default from the opt-in `parser.ts` tx-decode fallback (now no-ops unless explicitly pointed at a source), the legacy `HIRO_API_KEY` env fallback in `sl generate` / `sl subgraphs`, the vestigial blank `HIRO_*` env on the api service, and three zero-importer dead `stacks-api*` codegen files (legacy `stacks-node-api.*.stacks.co` URLs). Fix the false `.env.example` "polls Hiro" comment. (Hiro remains only in manual backfill/repair scripts, which aren't running services.)
