/**
 * Filter specs for `@secondlayer/sdk` subscriptions.
 *
 * Each `on.*` factory in this directory binds typed filter clauses to a
 * known table shape and returns a `SubscriptionFilterSpec`. Spread it into
 * a full subscription input alongside `name`, `url`, `format`, etc:
 *
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
 * The user supplies which subgraph + table to bind against — these factories
 * don't assume curated read endpoints are subscribable. To watch FT transfers
 * to an address, build a subgraph with a `transfers` table (see
 * `sl subgraphs create --template sip-010-balances`) and bind here.
 */

/**
 * What every factory takes as its first arg: which user-owned subgraph table
 * to filter against.
 */
export type FactoryTarget = {
	subgraph: string;
	table: string;
};

/**
 * A primitive value that can appear in a filter clause.
 * Mirrors `SubscriptionFilterPrimitive` in
 * `@secondlayer/shared/schemas/subscriptions` — duplicated here to keep
 * `@secondlayer/stacks` from importing the api/server schema package.
 */
export type FilterPrimitive = string | number | boolean;

/** Operator forms a filter clause can take. */
export type FilterOperator =
	| { eq: FilterPrimitive }
	| { neq: FilterPrimitive }
	| { gt: string | number }
	| { gte: string | number }
	| { lt: string | number }
	| { lte: string | number }
	| { in: FilterPrimitive[] };

/** A single column's filter: bare value (eq) or operator object. */
export type FilterClause = FilterPrimitive | FilterOperator;

/** Map of column → filter clause. Empty `{}` matches every row. */
export type Filter = Record<string, FilterClause>;

/**
 * Output of every `on.*` factory. Use directly as a partial input to
 * `sdk.subscriptions.create` — the SDK's existing `CreateSubscriptionRequest`
 * already accepts these three fields.
 */
export type SubscriptionFilterSpec = {
	subgraphName: string;
	tableName: string;
	filter: Filter;
};

/** Thin helper to build a spec without restating the field-name mapping. */
export function makeSpec(
	target: FactoryTarget,
	filter: Filter,
): SubscriptionFilterSpec {
	return {
		subgraphName: target.subgraph,
		tableName: target.table,
		filter,
	};
}
