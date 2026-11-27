# L2 Event Decoders

Decoder names use `decode.<event_type>.v<major>`.

`decode.ft_transfer.v1` is the first Stacks Index event decoder. The 11
classic decoders (ft/nft/stx transfer, mint, burn, lock, print) read Streams'
own reader (`readCanonicalStreamsEvents`, `../streams-events.ts`) in-process
off one shared cursor scan — `classic-decoders.ts` — instead of over HTTP
(plan-066). Protocol decoders (sbtc, pox5, bns) read the same reader
in-process, one filtered scan each — `protocol-decoders.ts`. The HTTP path
stays covered by the HTTP == in-process parity test
(`packages/api/src/streams/decode-dogfood.test.ts`) and every external and
subgraph consumer. Every decoder writes idempotent rows keyed by the Streams
cursor.

The continuous service stores its high-water cursor in `decoder_checkpoints`.
On cold start it resumes from that cursor. If no checkpoint exists, a classic
or sbtc/pox5 decoder scans from genesis; BNS seeds to the current tip.

The legacy `transactions` / `parseTransaction` path is indexer-internal. It is not the L2 public contract.
