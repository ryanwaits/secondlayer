/**
 * `on.*` — typed filter factories for `@secondlayer/sdk` subscriptions.
 *
 * Each factory binds typed filter clauses to a known table shape and
 * returns a `SubscriptionFilterSpec` (`{subgraphName, tableName, filter}`).
 * Spread it into your subscription create call:
 *
 *   import { on } from "@secondlayer/stacks";
 *   const spec = on.transferTo(
 *     { subgraph: "my-watcher", table: "transfers" },
 *     "SP1ABC...",
 *   );
 *   await sdk.subscriptions.create({
 *     ...spec,
 *     name: "watch-incoming",
 *     url: "https://my-app.com/webhook",
 *   });
 *
 * The first arg is the user's subgraph + table — these factories don't
 * assume Foundation Datasets are subscribable. Use a template
 * (`sl subgraphs new --template <slug>`) to scaffold a table that matches
 * the factory's expected column shape.
 */

export { bnsName, type BnsAction } from "./bns.ts";
export { poxStack, type PoxFunction } from "./pox.ts";
export { sbtcDeposit, sbtcWithdrawal } from "./sbtc.ts";
export {
	type FactoryTarget,
	type Filter,
	type FilterClause,
	type FilterOperator,
	type FilterPrimitive,
	makeSpec,
	type SubscriptionFilterSpec,
} from "./spec.ts";
export { sip009Transfer, sip010Transfer, transferTo } from "./transfer.ts";
