---
"@secondlayer/cli": minor
---

Freeze local-dev command groups (`sl local`, `sl devnet`): hidden from `sl --help` and every invocation now prints a one-line deprecation notice to stderr. Functionality unchanged; the hosted dev loop (`sl subgraphs create/deploy`) is the supported path.
