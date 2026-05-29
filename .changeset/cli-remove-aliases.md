---
"@secondlayer/cli": major
---

Remove the deprecated aliases that were kept for back-compat in the previous release, leaving only the canonical names. Breaking changes:

- **Commands removed** (use the canonical form): top-level `create` (→ `subscriptions create`), `billing` (→ `account billing`), `generate` (→ `contracts generate`), and `stack` (→ `local up` / `local down`). `account profile` is gone (→ `account get` / `account update`). Verb aliases dropped: `subgraphs new` (→ `create`), `subgraphs stop` (→ `cancel`), `config show`/`clear` (→ `get`/`delete`), `projects current` (→ `get`), `db reset` (→ `truncate`).
- **Flags removed**: `--preview` (→ `--dry-run`), `--force` as a confirm-skip (→ `-y`/`--yes`; `--force` remains only for genuine overrides like `subgraphs delete`), `--from`/`--to` and `--from-height`/`--to-height` (→ `--from-block`/`--to-block`), `--out` (→ `-o`/`--output`), and `--tail` on `devnet logs` (→ `--lines`).
- **Env vars**: `SL_SERVICE_KEY` and `SL_STREAMS_API_KEY` are no longer read — use `SL_API_KEY`.

Also: `subgraphs inspect` is merged into `subgraphs spec <nameOrFile>` (accepts a deployed name or a local `.ts` file), and `local up [--devnet]` / `local down [--devnet]` are the canonical way to run the full local stack or a Clarinet devnet.
