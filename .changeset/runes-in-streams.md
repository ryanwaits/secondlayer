---
"@secondlayer/api": minor
---

Adds `chain=bitcoin` to every `/v1/streams/*` route: Runes events (`rune_etch`, `rune_mint`, `rune_transfer`, `rune_burn`) on their own cursor space, filtered by `rune`/`address`. The Stacks default (`chain` omitted) is unchanged except an additive `chain: "stacks"` field on every event.
