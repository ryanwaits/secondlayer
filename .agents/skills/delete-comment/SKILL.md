---
name: delete-comment
description: >
  Classify and purge code comments in Secondlayer product code (packages/<name>/src,
  apps/web/src), then shrink the comment ratchet baseline. Use when the user runs
  "/delete-comment", asks to "delete comments", "purge comments", "shrink the comment
  baseline", or "clean up comments in <path>".
arguments:
  - name: target
    description: Directory or file under packages/<name>/src or apps/web/src (e.g. "packages/sdk/src"). Omit to pick the package with the largest baseline.
    required: false
---

# /delete-comment

Product code carries no comments. `scripts/ci/comments.ts` is the ratchet: CI fails
when a file gains comment lines over `scripts/ci/comments.baseline.json`. This skill
shrinks the baseline one target at a time.

Out of scope (the script already exempts them): tool directives (`biome-ignore`,
`@ts-*`, pragmas), license headers, JSDoc on exported symbols of published packages.
Never touch tests, `scripts/`, migrations SQL strings, or string/template contents.

## 1. List

```
bun scripts/ci/comments.ts --list <target>
```

No target: sum `comments.baseline.json` by package, take the largest.

Over ~150 blocks: split by subdirectory and fan out one agent per slice (disjoint
files; worktree isolation if the user's tree is dirty), unless the user asks for a
single-agent run. Each agent gets this file and its slice. Agents never stage or commit.

## 2. Classify every block

Read the code around each comment before deciding. One label per block:

| Label | Test | Action |
|---|---|---|
| Tautology | Restates the next line, the name, or the type. | Delete |
| Stale | Names a file, function, flag, ticket, plan, or behavior that no longer exists or no longer matches (grep it). | Delete |
| Excuse | Justifies a hack: "workaround", "hack", "for now", "TODO", "temporary", "until X ships", "not ideal". | Delete; list in report |
| Decision Record | Non-obvious *why* a competent reader would "fix" into a bug: protocol/consensus rule, external system quirk, security invariant, measured perf choice, reorg/cursor contract. | Keep; list in report |

Ties: Stale beats Decision Record (a wrong why is worse than none). Tautology beats
Decision Record when the why is already obvious from a name or test.

- Mixed block: label each sentence. Delete the tautology/stale sentences, keep the
  decision sentences in place. Never rewrite or convert (no `//` to JSDoc).
- Section dividers (`// ── X ──`), narration, and repeated notes = Tautology.
- "This cast is sound because ..." = Decision Record only when the reason is not
  visible within a few lines; otherwise Tautology.
- Comment alone inside an empty `catch`: delete unless it is a Decision Record;
  the resulting `catch {}` is accepted.

## 3. Delete

- Remove only comment text. No code, rename, or format change beyond what Biome does.
- Trailing comment: strip it, keep the code on that line.
- JSX `{/* ... */}`: remove the whole braces expression.
- Then: `git diff --name-only -- <target> | xargs bunx biome check --write`
  (collapses leftover blank lines).

## 4. Verify

```
git diff -U0 -- <target> | grep '^+[^+]'   # only lines that lost a trailing comment
bun run --filter <pkg> typecheck
bun scripts/ci/comments.ts --write && bun scripts/ci/comments.ts
```

Any added line that is not "same code minus trailing comment" means a code edit
slipped in: revert that hunk. Run the package's tests if any trailing comment sat
inside a template string or regex neighborhood.

## 5. Report (ephemeral, in chat only)

Nothing is persisted: no issues, no ADRs, no plan files. Report:

```
target            packages/sdk/src
blocks            255  (tautology 120, stale 40, excuse 15, decision 80)
not counted       script exemptions (directives, license, public JSDoc, tests)
lines shed        410  (baseline 672 -> 262)

Excuses (deleted; the hack is still in code)
  file:line   what is hacky, one line

Decision Records (kept)
  file:line   the decision, one line
```

The user reviews the two lists and decides what, if anything, happens next. Do not
commit; the user runs /done.
