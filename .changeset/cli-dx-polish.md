---
"@secondlayer/cli": minor
---

Polish CLI output and discoverability (non-breaking). Color is now gated on the terminal (honors `NO_COLOR`/`FORCE_COLOR` and auto-disables when piped), and status/progress messages are routed to stderr so `--json` and raw data on stdout pipe cleanly into `jq`. Adds `--json` to `whoami`, `billing status`, `config show`, and `project list`/`current`. `sl --help` now groups commands into labeled sections, mistyped commands get "Did you mean…?" suggestions, and the data commands (`subgraphs query`/`reindex`/`backfill`/`scaffold`/`new`, `streams events`/`consume`, `datasets query`, `subscriptions update`/`replay`, `config set`, `generate`) gained `Examples:` blocks. API errors now print actionable next-step hints.
