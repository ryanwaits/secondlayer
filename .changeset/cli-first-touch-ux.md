---
"@secondlayer/cli": minor
---

First-touch CLI UX:

- `sl subgraphs deploy` prints `Dashboard:`, `REST:`, and `Watch:` URLs after success (uses new `deriveBaseUrl` helper).
- `sl subgraphs deploy` auto-detects missing `@secondlayer/subgraphs` SDK and prompts to install via `bun add`.
- `sl subgraphs delete` no longer dies with raw `ExitPromptError` when stdin isn't a TTY — prints a friendly hint to use `-y`.
- `sl create subscription --runtime <bogus>` now errors upfront with valid choices listed, instead of creating a directory then throwing `template dir missing`.
- All 4 subscription templates (node, inngest, cloudflare, trigger) now ship `.env.example` and get `.env` written on create.
- Subscription create success block prints dashboard URL + `sl subscriptions resume` hint if the subscription is paused.
- Inngest template switched from `npx inngest-cli` to `bunx inngest-cli` (works under Bun's postinstall sandbox).
- Node template README updated to drop the stale "copy .env.example → .env" line (CLI already does it).
