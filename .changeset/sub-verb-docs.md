---
"@secondlayer/cli": patch
---

Update the subscription scaffold template and the `test --post` preview to document the full `<subgraph>.<table>.<created|updated|deleted>` event-type shape, so generated receivers and previews reflect that the verb now tracks the row op rather than always being `created`.
