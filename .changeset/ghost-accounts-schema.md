---
"@secondlayer/shared": minor
---

Ghost accounts schema (migration `0093_ghost_accounts`): `accounts.ghost` boolean flag + `accounts.email` made nullable (the plain UNIQUE constraint stays — Postgres unique ignores NULLs, so `ON CONFLICT (email)` upserts are unaffected), new control-plane `claim_tokens` table (hashed one-time tokens that attach an email to a ghost account via the magic-link flow), and a `GHOST_KEY_READ_ONLY` → 403 mapping in `CODE_TO_STATUS`. Backs the anonymous self-serve key mint (`POST /v1/keys`).
