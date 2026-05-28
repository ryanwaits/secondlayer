---
"@secondlayer/sdk": minor
"@secondlayer/cli": minor
"@secondlayer/api": minor
---

Add a typed Datasets client and `sl datasets` CLI command for the Foundation Datasets (`/v1/datasets/*`) — previously HTTP-only. The SDK `Datasets` client offers uniform `list`/`walk` (cursor) for the event datasets (sBTC, BNS, PoX-4, STX transfers) plus bespoke methods for BNS names/namespaces/resolve and network-health. `sl datasets list` / `sl datasets query <dataset> --filter k=v` query from the terminal. Adds an `address` super-filter to the pox-4 calls dataset that matches a stacker's activity across any role (caller, stacker, or delegate_to).
