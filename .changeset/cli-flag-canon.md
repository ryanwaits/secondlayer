---
"@secondlayer/cli": minor
---

Canonicalize CLI flags toward one consistent vocabulary, keeping old names working as deprecated aliases:

- Confirm-skip is now `-y`/`--yes` everywhere. `--force` is reserved for genuine overrides (cancel active work / force-delete); where it previously meant "skip prompt" (`subgraphs deploy`, `local node stop`/`restart`) it stays as a deprecated alias for `--yes`.
- Block ranges are `--from-block`/`--to-block` across `subgraphs reindex`/`backfill` and `streams events`; the old `--from`/`--to` and `--from-height`/`--to-height` remain as deprecated aliases.
- Output paths use `-o`/`--output` (with `--out` kept as a deprecated alias on `generate`); `subgraphs scaffold` gains the `-k` short for `--api-key`.
- `--preview` is now a deprecated alias for `--dry-run`.

Note: a few short flags were disambiguated and are no longer accepted on certain commands — `-f` is reserved for `--follow` (so `local start --foreground`, `local node stop/restart`, and `login --force` lose their `-f` short), and `-n` is reserved for `--lines` (so `devnet status --limit` loses `-n`, and `devnet logs --tail` becomes `--lines` with `--tail` kept as an alias). Use the long-form flags instead.
