---
"@secondlayer/api": minor
---

Index `tip.block_height` is now the committed height for the event type a request actually reads, not the ft_transfer decoder's checkpoint applied to every type. `/v1/index/events` (and the `ft-transfers`/`nft-transfers` aliases) now bound `to_height`/pagination by their own decoded type, fixing a gap where a type whose decoder trailed ft_transfer could silently skip rows that decoder hadn't written yet. The tip envelope also carries a new `decoded_heights` map (committed height per classic decoded type); `/v1/index/blocks` and `/v1/index/transactions` are unaffected, staying on the ingest tip.
