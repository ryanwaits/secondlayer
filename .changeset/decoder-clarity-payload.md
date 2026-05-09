---
"@secondlayer/indexer": patch
---

fix(decoders): use `raw_value` hex when decoding streams print payloads

`decodeClarityPayload` in the BNS and sBTC decoders read `payload.value`, expecting a hex-shaped object. The streams API returns a structured `{Tuple: {data_map: ...}}` representation in `value` (which the decoder then passed through, undecoded), with the canonical hex form in a separate `raw_value` field. Net effect: BNS read events without producing any rows; sBTC would have hit the same path if the in-DB decoder were ever turned on. Decoders now prefer `raw_value` and fall back to the structured form for test fixtures.
