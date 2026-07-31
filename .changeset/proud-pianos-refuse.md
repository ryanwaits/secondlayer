---
"@secondlayer/stacks": minor
---

Three filter-union fixes from the cross-surface audit: renames stop masquerading as capability gaps, and one runtime 400 becomes a projection-time throw.

`on.stxLock({ lockedAddress }).toIndexParams()` now projects to `sender` — the Index normalizes stx_lock's locked address INTO the `sender` column, so refusing the field was wrong. Same for `on.contractCall({ caller }).toContractCallsParams()`: the endpoint filters by tx sender, which IS the caller. Both Streams throws stay — the raw payload key there really is `locked_address`.

`trait` together with `contractId` now throws at projection time naming the fix ("the Index treats them as mutually exclusive — drop one, or use a subgraph source, which ANDs the pair") instead of reaching the server as a 400. Every other Index-unexpressible input already behaved this way.

The projection param shapes now declare what the projections always passed through: `contractId` is `string | readonly string[]` on the Index, contract-calls, and Streams fragments — destructuring a contract set no longer types as a lone string. And the wildcard refusal message no longer claims wildcards are "Subscriptions-only": Subgraph sources support them too, and always did.
