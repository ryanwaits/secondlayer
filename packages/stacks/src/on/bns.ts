import {
	type FactoryTarget,
	type SubscriptionFilterSpec,
	makeSpec,
} from "./spec.ts";

export type BnsAction =
	| "new-name"
	| "transfer-name"
	| "renew-name"
	| "burn-name"
	| "new-airdrop";

/**
 * Match BNS-V2 name lifecycle events.
 *
 * Bind against a subgraph table that mirrors the `bns_name_events` shape
 * (topic, namespace, name, owner, ...). Easiest path: scaffold via
 * `sl subgraphs new --template bns-names`.
 *
 * @param action restrict to one topic; omit to fire on every name event
 */
export function bnsName(
	target: FactoryTarget,
	action?: BnsAction,
	opts?: { namespace?: string; owner?: string },
): SubscriptionFilterSpec {
	return makeSpec(target, {
		...(action && { topic: action }),
		...(opts?.namespace && { namespace: opts.namespace }),
		...(opts?.owner && { owner: opts.owner }),
	});
}
