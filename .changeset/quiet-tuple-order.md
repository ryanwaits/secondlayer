---
"@secondlayer/stacks": minor
---

Core correctness: tuple fields serialize in the node's byte order so SIP-018 hashes match `to-consensus-buff?`; the Clarity deserializer caps nesting at 64 levels, checks declared list and tuple counts against the bytes left, and every short read throws `SerializationError` instead of returning NaN; `Cl.principal` and `parseContractId` reject extra dot segments and undecodable addresses through `parsePrincipal`; `parseUnits`/`parseStx` refuse exponent-form numbers, empty strings and silent rounding with a descriptive `RangeError`; legacy Bitcoin addresses passed to `pox` now fail on a bad base58check checksum (one decoder shared with `pox5`, one `base58CheckEncode` in `bitcoin`); `apiKey` no longer appears on `transport.config`; `HttpRequestError.details` is capped at 4KB; `@scure/base` is declared as a dependency.
