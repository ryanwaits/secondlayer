---
"@secondlayer/shared": patch
"@secondlayer/api": minor
"@secondlayer/worker": minor
---

x402 optimistic finality tier (Sprint B): Index/Streams now serve **near-instant** on broadcast-accept (the node admitting the sponsored tx to its mempool), reconciling asynchronously, instead of blocking ~5–29s for canonical confirmation. Gated per-principal by an optimistic gate (`x402/optimistic-gate.ts`) — a fixed-window velocity cap plus a reputation strike counter — that **fails closed** to confirmed-tier; high-value surfaces can stay `confirmed`. `settlePayment` gains a broadcast-no-await mode (`state: "optimistic"`), the catalog carries per-surface `finality` (Index/Streams default optimistic), and the worker reconciler now advances `pending → confirmed | reverted` and records a strike (shared Redis key, `x402StrikeKey`) on revert so repeat droppers lose optimism. Reconciliation confirms against our own indexed `decoded_events` (canonical-gated) — the same substrate the confirmed-tier serve verifies against — so it's self-contained / RPC-free.
