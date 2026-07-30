---
"@secondlayer/cli": minor
---

New `sl subgraphs test <file> --from <h> --to <h>` — run a subgraph's handlers against real chain data without deploying.

Until now the only feedback loop was production, and it showed: three of four production subgraphs shipped broken, one holding 0 rows chain-wide for a whole release because of a three-line field-mapping bug. The verb is `test`, not `replay` — `replay` already means "re-deliver historical rows to a webhook" in two other places in this CLI.

- The first run records a **cassette**, so later runs replay offline and free (`--offline`). The cassette is keyed by the source filters and the decoder version: change either and it is discarded rather than silently passing against data the subgraph would no longer request.
- Reads are metered, so a range is required and `--to` defaults to `--from + 100` instead of sweeping the chain. Reading below the free window prints the oldest seekable height instead of a stack trace.
- If events arrive and the handlers write **nothing**, the command fails — that is the exact shape of the field-mapping bug that ships a 0-row subgraph. An empty range is reported as an empty range, not a failure.

The `sip-010-balances` starter template no longer types its helper `ctx: any`; it moves balances with `ctx.increment` (atomic, commutative, replay-safe) instead of a read-modify-write. A new test type-checks every shipped template as real code.
