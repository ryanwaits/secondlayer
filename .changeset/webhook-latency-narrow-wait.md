---
"@secondlayer/shared": patch
---

Two fixes. `IndexHttpClient.getIndexTip()` takes an optional `eventTypes` — scopes the returned (and `wait`-compared) tip to the MIN committed height over just those types instead of the global floor over every classic decoder, so an unrelated decoder committing can no longer flip an unrelated `wait` to "non-empty" early. Also: the decoder-checkpoint write that backs the `index:tip` NOTIFY now skips the write (and the NOTIFY) when the committed cursor hasn't actually changed, fixing both a NOTIFY storm from idle decoders re-committing their unchanged cursor every empty poll, and a bug where that same "did it change" check used `!=` instead of `IS DISTINCT FROM` — since SQL's `NULL != x` is `NULL`, not true, a decoder's very first commit (from an unset `NULL` checkpoint) was silently dropped.
