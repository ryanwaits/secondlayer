---
"@secondlayer/cli": major
---

Canonicalize the command grammar toward a consistent `<noun> <verb>` shape, with the previous names kept working as aliases (to be removed in a future major). This is a major release because of these aliased renames plus the flag and `whoami` exit-code changes from the same release.

- **Resource creation** is now `<noun> create`: `sl subscriptions create` (was `sl create subscription`) and `sl subgraphs create` (alias `new`). The top-level `create` group is deprecated.
- **Account & billing**: `sl account get` / `sl account update` replace the flag-overloaded `account profile` (kept as a deprecated alias), and billing moves to `sl account billing` (top-level `billing` deprecated).
- **Codegen**: Clarity→TypeScript generation is now `sl contracts generate` (top-level `sl generate` deprecated; `gen` still works).
- **Projects**: the noun is pluralized to `sl projects` (alias `project`), and `projects get` replaces `projects current` (aliased). `ls` is now an alias for every `list`.
- **Verb consistency**: `sl subgraphs get` (alias `status`), `sl subgraphs cancel` (alias `stop`), `rm` as an alias for every `delete`, `sl config get`/`config delete` (aliases `show`/`clear`), and `sl db truncate` (alias `reset`).
- **Local dev**: database inspection is now nested as `sl local db` (top-level `db` deprecated).

Deferred to a follow-up: a unified `sl subgraphs generate <types|schema|client>` dispatcher, merging `inspect` into `spec`, and folding `stack`/`devnet` into `local up`/`local up --devnet` (those involve reconciling distinct service-orchestration semantics, not a mechanical rename).
