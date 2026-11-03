---
"@secondlayer/cli": minor
"@secondlayer/shared": patch
---

`secondlayer devnet connect` now runs the one-box Secondlayer runtime, the same image as the self-host compose, and pulls it before starting. Webhooks and decoded Index reads now work on devnet, deliveries are signed with a local dev key, and the stack runs on Apple Silicon. `devnet logs` services are now `secondlayer` and `postgres`.
