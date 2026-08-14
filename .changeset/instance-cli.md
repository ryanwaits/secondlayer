---
"@secondlayer/cli": major
---

Replace `sl instance init|bootstrap|observer` with top-level `sl init`, `sl bootstrap`, and `sl observer`. `sl init` writes `.env.local` (token, secrets key, webhook signing key) instead of `secondlayer.config.ts`. No alias. Hide hosted login, account, keys, and project commands from help.
