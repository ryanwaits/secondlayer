---
"@secondlayer/cli": minor
---

Remove the `testing()` codegen plugin. Clarinet simnet tests use `getContract` with `@secondlayer/stacks/simnet`. The `clarinet()` plugin now depends on `@stacks/clarinet-sdk`.
