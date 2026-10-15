---
"@secondlayer/subgraphs": patch
---

Hosted sBTC and trait-scoped webhooks now deliver. They matched nothing on hosted stacks before; self-host was unaffected. A hosted stack (no local chain) reads sBTC events, trait members and sweep settlements from the hosted Index API instead of its own empty tables; hosted subgraph `trait` sources resolve the same way.
