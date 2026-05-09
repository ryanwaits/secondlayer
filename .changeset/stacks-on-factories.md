---
"@secondlayer/stacks": minor
---

feat(stacks): add `on.*` filter factories for typed subscription specs

Six typed factories that produce `SubscriptionFilterSpec` objects (just `{subgraphName, tableName, filter}`) for `@secondlayer/sdk` subscriptions:

- `on.transferTo(target, recipient, opts?)` — match transfers into an address
- `on.sip010Transfer(target, asset?, opts?)` / `on.sip009Transfer(target, asset?, opts?)` — token-class sugar
- `on.bnsName(target, action?, opts?)` — BNS-V2 name lifecycle (`new-name`, `transfer-name`, `renew-name`, `burn-name`, `new-airdrop`)
- `on.poxStack(target, fn?, opts?)` — PoX-4 stacking calls
- `on.sbtcDeposit(target, opts?)` / `on.sbtcWithdrawal(target, opts?)` — sBTC lifecycle

The first arg is `{subgraph, table}` — factories don't assume Foundation Datasets are subscribable; bring your own subgraph (see `sl subgraphs new --template <slug>`). Pure addition, no breaking changes.
