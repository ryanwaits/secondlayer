---
"@secondlayer/sdk": minor
"@secondlayer/cli": patch
---

New `@secondlayer/sdk/streams/rows` subpath for the per-type guard + decode pairs that return **database row** shapes (`decoded_payload` nested, `source_cursor` carried), as distinct from the flat API rows `decode()` returns.

They are not going away — building a `decoded_events`-shaped projection is a real use, and it is what our own decoder does. They move here so reaching for the storage shape is deliberate rather than the first thing autocomplete offers. If you are writing a consumer you still want `decode(event)`, or `decoded: true` on `streams.events.consume`, so decoding never appears in your handler.

The root and `/streams` barrels keep re-exporting them until the next major.

CLI: `sl subgraphs test` no longer casts its event type through `any`. The source-type lookup is validated against the canonical decoded vocabulary, so a source type the Index API does not serve is skipped rather than reaching the API as a 400.
