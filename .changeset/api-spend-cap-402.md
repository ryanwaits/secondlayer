---
"@secondlayer/api": patch
---

Refuse a keyed Index/Streams read past the free 1M rows with 402 `spend_cap_reached` once the account's monthly spend cap is reached, so a spend cap actually pauses reads.
