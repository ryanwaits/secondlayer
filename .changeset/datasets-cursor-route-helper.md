---
"@secondlayer/api": patch
---

Dataset cursor-paginated routes now share one `cursorRoute` helper instead of copy-pasted validate→tip→503→respond boilerplate; the 503 empty-envelope row key and the tip guard live in one place, removing drift between the block-height and burnchain variants. No response-contract change.
