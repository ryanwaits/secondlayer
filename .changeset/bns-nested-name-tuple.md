---
"@secondlayer/indexer": patch
---

fix(bns): read nested `{name: {name, namespace}}` shape from on-chain emit

The on-chain BNS-V2 contract emits the FQN as a nested tuple — `name = {name: <buff>, namespace: <buff>}` — not as flat sibling keys on the print payload. The decoder was reading flat keys and silently producing zero rows for every name event. It now prefers the nested shape and falls back to flat keys for legacy fixtures.
