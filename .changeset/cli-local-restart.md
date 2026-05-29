---
"@secondlayer/cli": minor
---

Add a full-stack `sl local restart` that pairs with `local up`/`local down` — it stops then starts the whole local stack (Stacks node + dev services), and accepts the same `--devnet` / `--no-node` / `--no-dev` / `--wait` flags.

Behavior change: `local restart` previously restarted only the dev services. It now restarts the full stack by default. To get the old in-place dev-services-only restart (which preserves docker containers), use `local restart --no-node`.
