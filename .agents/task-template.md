# Task Template

## Title

Name the task in one line.

## Goal

State the outcome. Keep it concrete.

## Scope

In:

- List included work.

Out:

- List excluded work.

## References

- ADRs:
- PRDs:
- Prior PRs or commits:

## Decisions To Surface

- List missing decisions.
- Write `None` only after checking `.agents/DECISIONS.md`.

## Validation

- [ ] `/check` ran and reported green.
- [ ] `/done` ran to produce commits. No manual `git commit` or `git push`.
- [ ] If a continuous service or new endpoint was added, a smoke test was added under `tests/smoke/` and is part of the green run.
- [ ] If an ADR was needed, it landed in its own commit ahead of the implementation commit.
- [ ] Voice and naming rules verified against changed files.

## Out Of Scope

- List non-goals explicitly.
