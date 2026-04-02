---
"@secondlayer/subgraphs": patch
"@secondlayer/shared": patch
"@secondlayer/indexer": patch
---

Fix subgraph runner payload bugs: convert FT/STX amounts to BigInt, extract print event topic from decoded Clarity value, store function_args and raw_result in transactions table, include raw_result in hiro-pg and local replay payloads
