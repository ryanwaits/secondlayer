---
"@secondlayer/sdk": minor
---

Expose `datasets` and `contracts` clients on the `SecondLayer` root client. `sl.datasets` reaches the Foundation Datasets API (including the `listDatasets()` catalog), and the new `sl.contracts.list({ trait })` wraps `/v1/contracts` for trait-based contract discovery.
