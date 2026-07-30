---
"@secondlayer/stacks": major
"@secondlayer/sdk": minor
---

**Breaking:** `on` is now the chain-event filter union at the root of `@secondlayer/stacks`, not a second set of factories.

The name previously held an older namespace keyed on snake_case database column names and typed `Record<string, FilterClause>` — so a typo in a column name compiled and silently matched nothing. It had no consumers. It is removed, along with the `Filter`, `FilterClause`, `FilterOperator`, `FilterPrimitive`, `SubscriptionFilterSpec`, `BnsAction`, `FactoryTarget`, and `PoxFunction` types it exported.

`import { on } from "@secondlayer/stacks"` now gives you the typed union — per-event-type fields, and explicit projections onto each surface (`.toIndexParams()`, `.toStreamsParams()`, `.toChainTrigger()`, `.toSubgraphSource()`). It is the same object as `@secondlayer/stacks/filters`; both paths are supported.

If you used the old `on.transferTo(...)` / `on.bnsName(...)` / `on.poxStack(...)` factories, build the equivalent filter with `on.ftTransfer({ … })` etc. and project it onto the surface you're calling.

SDK: `events.walk({ fields })` now narrows its yielded row type the way `events.list` already did — it forwards `fields` to the wire, so without the overload it yielded stripped rows while the type promised every column. The callable `index.events({ fields })` shorthand narrows too. `events.consume` no longer accepts `fields`: the consume loop never forwarded it, so it type-checked and was then silently dropped.
