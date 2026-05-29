# Launch Thread — 2026-05-27

Draft for the Sprint 8 day-of post. 5–7 tweets. Hook → datasets → curl → subgraphs → CTA. Each tweet ≤ 270 chars to leave room for handles/polish.

---

## Tweet 1 — Hook

> The chain produces events. Every team building on Stacks rebuilds the same indexing infrastructure — own nodes, own decoders, own reorg handling, own schemas. That work is undifferentiated. It should be a utility.
>
> Today we run that utility. → secondlayer.tools

*(attach: home page screenshot)*

---

## Tweet 2 — Five Foundation Datasets

> Five Foundation Datasets, public goods, free forever:
>
> · STX transfers
> · sBTC events + token movements
> · PoX-4 stacking calls
> · BNS-V2 names
> · Network health
>
> Decoded, queryable, hosted. No node, no decoder, no auth.

*(attach: /docs/datasets index)*

---

## Tweet 3 — Curl one-liner

> One curl, real data:
>
> ```
> curl https://api.secondlayer.tools/v1/datasets/stx-transfers?limit=2
> ```
>
> Cursor pagination. Stable schema. Same shape across every dataset.

*(attach: terminal screenshot of the response)*

---

## Tweet 4 — Subgraphs for custom shapes

> Outgrow public datasets? Define your own shape with a subgraph:
>
> ```
> sl subgraphs create my-app --template sip-010-balances
> sl subgraphs deploy
> ```
>
> Get a dedicated Postgres you can SSH into. Four templates ship today (SIP-010 balances, sBTC flows, PoX stacking, BNS names).

*(attach: /docs/subgraphs page)*

---

## Tweet 5 — sBTC parquet

> sBTC ships as parquet on R2 — pull a finalized block range with DuckDB or any parquet reader. Discover the latest range via per-family `manifest/latest.json`.
>
> Same data the protocol team uses for analytics. No infra to set up.

*(attach: /docs/datasets/sbtc DuckDB snippet)*

---

## Tweet 6 — Lineage + public good

> The architectural model isn't ours — Thomas Osmonson (@aulneau) at Fundamental Systems wrote it down in 2022 as Project Kourier. We ship the running system.
>
> SDKs, CLIs, subgraph templates: open source. The Foundation Datasets: free forever.

---

## Tweet 7 — CTA

> Start here:
>
> · 5-min curl path → secondlayer.tools/docs
> · Subgraphs in 30 min → secondlayer.tools/docs/subgraphs
> · Status (live) → api.secondlayer.tools/public/status
>
> If you build on Stacks, give us a workload. We'll make it boring.

---

## Notes

- Replace screenshot placeholders with real captures from T7b.1.
- Reorder if a tweet runs long; tweets 1, 2, 3, 7 are the spine — 4, 5, 6 are cuttable.
- Confirm @aulneau handle before posting. Double-check Project Kourier reference link or attach the transcript path.
- Schedule for 9am CT 2026-05-27 (peak US dev Twitter).
- Pin the thread to the launch day.
