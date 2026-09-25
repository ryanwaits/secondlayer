---
"@secondlayer/cli": patch
---

The CLI no longer crashes on install when the optional `@stacks/clarinet-sdk` peer isn't present. Only Clarinet-backed commands need it, and they now say how to install it.
