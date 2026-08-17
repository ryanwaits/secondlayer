---
"@secondlayer/cli": minor
---

Add `secondlayer setup` — a guided self-host onboarding wizard.

Replaces the previous five-command, one-manual-copy-paste onboarding path with one command:
secrets generation, `docker-compose.yml` + `.env` written directly into a target directory (no
more copying secrets by hand), the stack brought up, the observer stanza printed for an external
node, and verified history restored and checked.

Interactive by default (a real terminal UI, built on `@opentui/react`); without a TTY, or with
`--yes`, it skips the prompts and runs the identical steps from flags — `--network`, `--node-mode`,
and `--against` (unless `--skip-bootstrap`) are required explicitly in that mode, so an agent can
drive it exactly as well as a human at a terminal.

`scripts/oss-bootstrap.ts` is removed — it minted an older account+API-key credential that no
longer matches how self-hosted instances authenticate.
