---
"@secondlayer/stacks": patch
---

Harden nonce manager: reconciler no longer leaks unhandled rejections from a throwing onError callback; getNonce throws a clear error on a malformed node response.
