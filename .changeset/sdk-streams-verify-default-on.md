---
"@secondlayer/sdk": minor
---

Streams response signatures are now verified **by default**. `createStreamsClient`
(and `sl.streams.events.subscribe`) verify the ed25519 `X-Signature` on REST
reads and the per-frame SSE signature without opting in. The default is
*lenient*: the hosted API signs every response so it is verified, while an
unsigned response from a self-hosted instance with no `STREAMS_SIGNING_PRIVATE_KEY`
passes through — an *invalid* signature always throws. Pass `verify: true` (or
`{ publicKey }` to pin a PEM) for strict mode where a missing signature also
throws, or `verify: false` to disable. Previously `verify` defaulted to off.
