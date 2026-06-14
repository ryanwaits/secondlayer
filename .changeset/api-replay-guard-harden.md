---
"@secondlayer/api": patch
---

Harden the BYO subgraph replay-safety guard. `hasNonReplayableWrites` now catches
the common ways the `ctx.method(` regex was dodged — method aliasing
(`const u = ctx.update`), destructuring (`const { update } = ctx`), bracket
access (`ctx["update"]`), and optional chaining (`ctx?.update`) — so a handler
that double-applies deltas on replay is flagged even when the delta call isn't
written inline. Still a heuristic (errs toward flagging); full context-object
aliasing remains a known gap tracked for an AST/runtime guard.
