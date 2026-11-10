# Factory intake adapters

Adapters for the open-source software factory (`~/projects/factory`). They bring Secondlayer's work queue into the factory. They live here so factory core stays generic.

| File | What |
|---|---|
| `feedback.ts` | Ongoing. Runs `scripts/ops/feedback-queue.ts --json` twice (customers, then `--internal` for Dogfood and Sentinel). Takes routes `human`, `schema_gap`, `docs`, `decode_fixture`; skips `low_priority`. |
| `dogfood-archive.ts` | One-time. Imports the 23 findings in `plans/assets/344-dogfood/export-20261110/findings/`. The archive is NOT in git (public repo, `plans/` is ignored; it holds customer ticket text; never force-add it). It lives on disk there, with a copy in `~/.factory/imports/dogfood-20261110`. Tests that need it skip when it is absent. Safe to leave in the config: the factory dedupes on id. |

`TARGET_DATABASE_URL` must be set in the shell that runs `factory tick` or `factory pull`, as a read-only role if one exists. Without it the feedback adapter reports `set TARGET_DATABASE_URL`; the archive import still works.

Neither adapter can reply to a ticket's author. Questions from clarify are answered by a developer with `factory reply`.

```ts
// ~/.factory/config.ts
import { secondlayerFeedback } from "/Users/ryan/projects/secondlayer/scripts/factory/feedback.ts";
import { dogfoodArchive, archivedTicketIds } from "/Users/ryan/projects/secondlayer/scripts/factory/dogfood-archive.ts";
const repo = "/Users/ryan/projects/secondlayer";
const dir = `${repo}/plans/assets/344-dogfood/export-20261110`;
export default () => ({
  adapters: [
    dogfoodArchive({ dir, project: "SL" }),
    secondlayerFeedback({ repo, project: "SL", skipTicketIds: archivedTicketIds(dir) }),
  ],
});
```

Tests: `bun test scripts/factory`.
