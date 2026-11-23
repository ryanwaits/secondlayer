---
name: delete-comment
description: >
  Classify and purge code comments in Secondlayer product code (packages/<name>/src,
  apps/web/src), then shrink the comment baseline. Use when the user runs
  "/delete-comment", asks to "delete comments", "purge comments", "shrink the comment
  baseline", or "clean up comments in <path>".
arguments:
  - name: target
    description: Directory or file under packages/<name>/src or apps/web/src (e.g. "packages/sdk/src"). Omit to pick the package with the largest baseline.
    required: false
---

# /delete-comment

Product code carries no comments. `comments.ts` (next to this file) measures it
against `baseline.json`. Not run in CI; this skill is the only enforcement. Each run
shrinks the baseline for one target.

```
S=.agents/skills/delete-comment
bun $S/comments.ts                  # check: any file over its baseline?
bun $S/comments.ts --count <path>   # comment lines under path
bun $S/comments.ts --list <path>    # every counted block, file:line + text
bun $S/comments.ts --write          # rewrite baseline (coordinator only)
```

Exempt by the script: tool directives (`biome-ignore`, `@ts-*`, pragmas), license
and attribution headers (MIT/CC0), and in published packages JSDoc on exported
symbols and type members (openpkg + IDE hovers). Never touch tests, `scripts/`,
generated files (e.g. `checkpoint-mainnet.ts`), or string/template contents.

**Keep JSDoc on a non-exported type that an exported signature names** (e.g.
`type Row`, `type StreamsConsumeCommon`). The script counts it, but openpkg
publishes its summary into the reference docs, and `reference-lint.test.ts` fails CI
without one. Label it Decision Record. Check: is the type name in a parameter,
return, or member type of an exported symbol?

## 1. List

`--count` then `--list` the target. No target: sum `baseline.json` by package, take
the largest.

Over ~150 blocks: fan out one agent per subdirectory slice, unless the user asks for
a single agent. Rules for fan-out:
- Slices are disjoint files. A script that walks a directory must filter to its own slice.
- Each agent uses its own scratch subdirectory (`<scratchpad>/delete-comment-<slice>/`).
  Never write generic names to the shared scratchpad root: agents overwrite each other.
- Agents never `--write`, stage, or commit. The coordinator writes the baseline once.

## 2. Classify every block

Read the code around each comment. One label per block:

| Label | Test | Action |
|---|---|---|
| Tautology | Restates the next line, the name, or the type. Dividers, narration. | Delete |
| Stale | Names a file, function, flag, ticket, plan, or behavior that no longer exists or no longer matches (grep it). | Delete |
| Excuse | Justifies a hack: "workaround", "for now", "TODO", "temporary", "until X", "untuned", compat shims for old callers/images/fixtures. | Delete; list in report |
| Decision Record | Non-obvious *why* a competent reader would "fix" into a bug: protocol/consensus rule, external quirk, security invariant, measured perf choice, reorg/cursor contract, why an error is swallowed. | Keep; list in report |

Ties: Stale beats Decision Record (a wrong why is worse than none). Tautology beats
Decision Record when the why is obvious from a name, type, or test.

- **Mixed block:** delete the tautology/stale/excuse sentences, keep the decision
  sentences. Rewrapping kept text is allowed; rewording is not, except dropping a plan
  or ticket code (`plan 057`, `f069`, `D10`) or a forbidden term (AGENTS.md naming).
- **Repeated note across files:** keep one copy at the authoritative site (definition,
  enforcement point, module header); delete call-site copies. Security notes: keep one.
- **Protocol facts on raw values** (opcode mnemonics, units like microSTX, wire tags,
  byte offsets) = Decision Record.
- **"This cast is sound because ..."** = Decision Record only when the reason is not
  visible within a few lines.
- **Comment alone in an empty `catch`:** delete unless it says why swallowing is
  correct; `catch {}` is accepted.
- **Misplaced JSDoc** (sits on the wrong symbol): move it to the right symbol if that
  symbol is exported; otherwise Stale.

## 3. Delete

- Remove only comment text. No code, rename, or format change beyond what Biome does.
- Trailing comment: strip it, keep the code on that line.
- JSX `{/* ... */}`: remove the whole braces expression, only when the parent is a JSX
  expression (AST check). A regex on braces breaks `catch { /* */ }`.
- Then: `git diff --name-only -- <target> | xargs bunx biome check --write`.

## 4. Verify

```
git diff -U0 -- <target> | grep '^+[^+]'
bun run --filter <pkg> typecheck
bun run --filter <pkg> test          # if under ~2 min
bun $S/comments.ts --count <target>
# sdk, stacks, subgraphs, verify: regenerate the reference docs, then lint them
bun run --filter <pkg> openpkg && bun test packages/<pkg>/src/reference-lint.test.ts
git status --short apps/web/src/generated   # changed? include it in the commit
```

Expected added lines: code minus a trailing comment, `catch {}` / `.catch(() => {})`
collapses, Biome joins, and rewrapped kept comment text. Anything else is a code edit
that slipped in: revert that hunk. Test failures from a missing/behind local DB
(42P01, 42703, permission denied) are environment, not this change; say so.

Coordinator, after all slices: `bun $S/comments.ts --write && bun $S/comments.ts`.

## 5. Report (ephemeral, in chat only)

Nothing is persisted: no issues, no ADRs, no plan files.

```
target            packages/sdk/src
blocks            255  (tautology 120, stale 40, excuse 15, decision 80)
lines shed        410  (672 -> 262)

Excuses (deleted; the hack is still in code)
  file:line   what is hacky, one line

Decision Records (kept)
  file:line   the decision, one line
```

The user reviews the two lists and decides what happens next. Do not commit; the
user runs /done.
