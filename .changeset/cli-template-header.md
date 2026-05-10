---
"@secondlayer/cli": patch
---

feat(cli): scaffolded subgraphs ship with a "what to do next" header

`sl subgraphs new <name> [--template <slug>]` now emits a 5-step header comment at the top of every scaffolded file (edit → deploy → wait for sync → query). Mirrors the `/docs/subgraphs#quickstart` walkthrough so new users don't bounce between the file and the docs to figure out next steps.
