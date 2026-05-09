---
"@secondlayer/indexer": patch
---

fix(indexer): pox4 decoder Invalid Date crash + l2 health reports all enabled decoders

- pox4 decoder was crashing every poll on `new Date(r.block_time)` because pg returns `blocks.timestamp` (bigint epoch-seconds) as a string of digits, which `new Date(string)` parses as a date *string* → Invalid Date. Coerce via `Number()` and multiply to ms.
- `getL2DecodersHealth()` defaulted to a hardcoded `[ft, nft]` list, hiding sbtc/pox4/bns from `/public/status` and the indexer's progress log even when their `*_DECODER_ENABLED` flags were set. Default now derives from those env flags.
- Adds temporary `bns_decoder.batch` log to count received vs. matched events for diagnosing why bns writes zero rows on prod; removed in a follow-up patch.
