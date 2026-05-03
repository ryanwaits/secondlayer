# L2 Event Decoders

Decoder names use `l2.<event_type>.v<major>`.

`l2.ft_transfer.v1` is the first Stacks Index event decoder. It consumes Stacks Streams through the public `/v1/streams/events` path and writes idempotent rows keyed by the Streams cursor.

The legacy `transactions` / `parseTransaction` path is indexer-internal. It is not the L2 public contract.
