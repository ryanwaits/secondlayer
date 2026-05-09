import {
	type FactoryTarget,
	type SubscriptionFilterSpec,
	makeSpec,
} from "./spec.ts";

/**
 * Match sBTC deposit completion events. Bind against a subgraph table
 * mirroring `sbtc_events` (topic, amount, sender, bitcoin_txid, ...).
 * Scaffold via `sl subgraphs new --template sbtc-flows`.
 */
export function sbtcDeposit(
	target: FactoryTarget,
	opts?: { sender?: string; bitcoinTxid?: string },
): SubscriptionFilterSpec {
	return makeSpec(target, {
		topic: "completed-deposit",
		...(opts?.sender && { sender: opts.sender }),
		...(opts?.bitcoinTxid && { bitcoin_txid: opts.bitcoinTxid }),
	});
}

/**
 * Match sBTC withdrawal lifecycle events. Phase defaults to all three
 * (`create` / `accept` / `reject`); pass an explicit `phase` to narrow.
 */
export function sbtcWithdrawal(
	target: FactoryTarget,
	opts?: {
		phase?: "create" | "accept" | "reject";
		sender?: string;
		requestId?: number;
	},
): SubscriptionFilterSpec {
	return makeSpec(target, {
		topic: opts?.phase
			? { eq: `withdrawal-${opts.phase}` }
			: { in: ["withdrawal-create", "withdrawal-accept", "withdrawal-reject"] },
		...(opts?.sender && { sender: opts.sender }),
		...(opts?.requestId !== undefined && { request_id: opts.requestId }),
	});
}
