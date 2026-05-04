# Agent Charter

## Mission

Second Layer is the data plane for Stacks. The chain produces events. Applications need those events shaped, decoded, joined, and delivered in ways no single API can anticipate. Today, every team building on Stacks rebuilds the same indexing infrastructure. That work is undifferentiated. It should be a utility. We run that utility.

## Product Surface

- Stacks Streams: real-time event stream.
- Stacks Index: queryable historical events.
- Free: $0, 10 r/s, 7-day window, Index rejected at API.
- Build: $99, 50 r/s on separate buckets, 30-day window.
- Scale: $499, 250 r/s on separate buckets, 90-day window.
- Enterprise: $1.5K-$5K+.

## Voice Rules

- Calm infrastructure tone.
- Short declarative sentences.
- No exclamation points.
- No emojis unless explicitly demanded.
- Never use direct competitive framing by name.
- Product names are Stacks Streams and Stacks Index.
- Use collect, extract, gather, read, or fetch for data access work.

## Decision Gate

When a prompt contains `STOP AND TELL ME before writing code` or `Start by replying with X, then proceed`, that is a hard stop. No code until the human confirms in chat. The confirmation then gets committed to `.agents/DECISIONS.md` before implementation lands.

## Direct-To-Main Contract

Every session reads `.agents/CHARTER.md` and `.agents/current-sprint.md` first.

Architectural decisions live in `.agents/DECISIONS.md`. If a task needs a decision not present, the agent stops, asks in chat, commits the resolution to `.agents/DECISIONS.md` in its own commit, then proceeds with implementation in a follow-up commit.

`/check` runs after every meaningful change and before any commit lands. It is the local green bar. The skill defines the exact checks.

`/done` runs at task or sprint completion. It produces logical commit groupings with standalone-readable messages and pushes to main when the human has requested direct-to-main work.

CI is the second gatekeeper. `/check` runs locally. CI re-runs the same gates plus voice and naming lint and bash lint on main. If CI fails after `/done` pushed, the agent's next action is fix-forward in the same session.

Continuous services require a smoke test in `tests/smoke/`. New endpoints require a contract test or a documented N/A reason in `.agents/current-sprint.md`. Smoke tests are part of the local green bar.

Commit messages are standalone-readable and code-specific. No `wip`, no vague fixes, no review-response messages. Do not include internal governance tokens, sprint names, phase names, or task numbers. `/done` enforces this.

Architectural decision coverage lives in `.agents/DECISIONS.md`, not commit messages. If an implementation needs a new decision, commit the decision log update first, then commit the code with a code-specific message.

## Slash Command Reference

`/check` — Local gate. Uses the existing Codex skill. Must be green before any commit. Never skip.

`/done` — Commit-and-push gate. Uses the existing Codex skill. Runs after `/check`, groups changes, and pushes to main when direct-to-main was requested.

`/release` — Reserved for production deploy steps that are not part of normal task flow. Out of scope for routine sprint work.

The commands are agent skills. Do not mirror them into `package.json` or a Makefile unless the skill behavior itself changes.

## Locked Tone Examples

Good: Stacks Streams returns ordered events with stable cursors.
Bad: Our event feed is magic and instant.

Good: Stacks Index returns decoded transfer events.
Bad: The API does everything developers need.

Good: Fetch the current cursor, then resume from `next_cursor`.
Bad: Pull everything and hope the local state matches.
