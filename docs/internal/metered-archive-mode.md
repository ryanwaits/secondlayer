# Metered-archive mode (D2 design note)

Status: draft for approval. Companion to `gate-g-deletion-manifest.md` (D2).

## The problem

The manifest's Slice C assumed prod eventually flips `INSTANCE_MODE=platform` →
`oss`. But every read gate is keyed on `isPlatformMode()` — flipping disarms the
meter (`read-credits.ts:66` returns undefined, `index/free-window.ts`,
`streams/retention.ts`, both rate-limit gates no-op), so credits would be
sellable but unspendable. The flip also drags in the hard reconciliations:
subgraph namespace/schema naming, SOURCE/TARGET DB-split collapse, Redis boot
guard.

## Recommendation: rename, don't flip

With D1 (accounts/magic-link kept as the metered account system), prod
api.secondlayer.tools **is** the metered archive service by design — "we run the
archive and sell bootstrap/backfill/reindex as metered work" is exactly what
platform mode does once Slices B+D strip plans/tenancy out of the code. So:

1. **`INSTANCE_MODE=archive` becomes an alias of today's platform mode.**
   One change in `shared/mode.ts`: `isPlatformMode()` returns true for both
   values; new `isMeteredReads()` = platform|archive (override:
   `METERED_READS=false`). Prod sets `INSTANCE_MODE=archive` for honest naming;
   zero behavioral change on flip day.
2. **Self-host (`oss`) is untouched** — gates stay disarmed, no accounts, no
   Redis, exactly as shipped.
3. **The consolidation (Slice B) and deletions (Slice D) shrink what platform
   mode *means*** until `archive` mode is simply: metered reads + accounts +
   credits + the product data plane. No mode flip event, no namespace
   reconciliation, no DB-split collapse, no console token switch — Slice C
   reduces to the env rename plus retiring the Redis boot guard if Redis is
   trimmed (it stays for ip-rate-limit + x402 per D3 anyway).

## What Slice C becomes

- Rename env on prod (`platform` → `archive`), deploy — cosmetic.
- Keep the Redis boot guard (Redis is retained per D3/ip-rate-limit).
- Everything previously listed as "flip preconditions" is deleted from the
  manifest or absorbed by Slices B/D.

## Consequence for P2/P6.10 language

"Withdraw hosted compute" is already true in substance after B+D: no plans, no
tenancy, no hosted subgraph deploys, no hosted console — what remains public is
the metered archive API + static docs + R2, which is the strategy's stated
endstate. The sprint plan's flip vocabulary should be read as this rename.
