# Roadmap — active work

> Radically refocused 2026-06-30. The decoded-sBTC-peg arc is shipped end-to-end (read API,
> lifecycle, summary, webhooks, PoX cycles, BTC L1 settlement confirmer, public Peg Explorer);
> genesis-decoder parity is resolved; pricing/trial/webhook-signing are live. We are deliberately
> NOT carrying a long deferred backlog. The prior multi-item roadmap was killed to focus on the
> single highest-leverage piece of unfinished business. The old backlog lives in git history (this
> file's prior revisions) if anything needs recovering.

## Wire floor-audit into CI/cron

> The durable regression guard for genesis-decoder parity — the core "every block decoded from
> genesis" contract, and the product's central claim. `floor-audit.ts` is built + tested + committed
> (`93990828`) but runs on-demand only — verified absent from `.github/workflows` and prod-smoke, so
> nothing runs it on a schedule. The failure it guards is **silent** (health stays green, tip stays
> current, only deep history goes missing) and has **already occurred once** (7 generic decoders
> floored at ~6.8M). A guard that nothing runs is a smoke detector with no battery.
>
> **Scope:** schedule it against the prod source DB (prod-smoke probe and/or post-deploy gate),
> route `!ok` to an alarm. Effort: **S** — the command and exit code already exist.
> File: `packages/indexer/src/decode/floor-audit.ts`.
