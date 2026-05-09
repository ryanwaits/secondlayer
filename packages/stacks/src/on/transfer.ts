import {
	type FactoryTarget,
	type SubscriptionFilterSpec,
	makeSpec,
} from "./spec.ts";

/**
 * Match transfer events into a recipient address.
 *
 * Works against any subgraph table that has a `recipient` column (and
 * optionally `asset_identifier`). Templates that scaffold this shape:
 * `sip-010-balances`, `sbtc-flows`.
 *
 * @param target the user's subgraph + table to bind against
 * @param recipient stx principal that should receive the transfer
 * @param opts.asset optional asset identifier (e.g. `"SP1...usdc::usdc-token"`)
 *   to filter to a specific FT/NFT contract
 */
export function transferTo(
	target: FactoryTarget,
	recipient: string,
	opts?: { asset?: string },
): SubscriptionFilterSpec {
	return makeSpec(target, {
		recipient,
		...(opts?.asset && { asset_identifier: opts.asset }),
	});
}

/**
 * SIP-010 (fungible token) transfer sugar — alias for `transferTo` that
 * makes the asset filter intent explicit at the call site. Same backing
 * filter; the `asset` param is optional (omit to match every SIP-010
 * transfer in the bound table).
 */
export function sip010Transfer(
	target: FactoryTarget,
	asset?: string,
	opts?: { recipient?: string },
): SubscriptionFilterSpec {
	return makeSpec(target, {
		...(asset && { asset_identifier: asset }),
		...(opts?.recipient && { recipient: opts.recipient }),
	});
}

/**
 * SIP-009 (non-fungible token) transfer sugar — same pattern as
 * `sip010Transfer`. Bind against an NFT-shaped table (see template
 * `nft-transfers` if/when published).
 */
export function sip009Transfer(
	target: FactoryTarget,
	asset?: string,
	opts?: { recipient?: string; tokenId?: string | number },
): SubscriptionFilterSpec {
	return makeSpec(target, {
		...(asset && { asset_identifier: asset }),
		...(opts?.recipient && { recipient: opts.recipient }),
		...(opts?.tokenId !== undefined && { token_id: String(opts.tokenId) }),
	});
}
