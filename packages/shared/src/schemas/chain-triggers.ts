// This file must stay import-free. The SDK's `webhooks/triggers` subpath
// re-exports it, and that reaches the browser through apps/web, so anything
// imported here (zod especially) would ship to the client bundle.
//
// CHAIN_TRIGGER_FIELDS is a literal, checked against ChainTriggerSchema in
// webhooks.test.ts so it can never drift behind the validator.

export const CHAIN_TRIGGER_TYPES = [
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"contract_call",
	"contract_deploy",
	"print_event",
	"nested_contract_call",
	"var_set",
	"map_set",
	"map_insert",
	"map_delete",
	"sbtc_deposit",
	"sbtc_withdrawal_create",
	"sbtc_withdrawal_accept",
	"sbtc_withdrawal_reject",
	"sbtc_withdrawal_swept_confirmed",
	"rune_etch",
	"rune_mint",
	"rune_transfer",
	"rune_burn",
] as const;

export type ChainTriggerType = (typeof CHAIN_TRIGGER_TYPES)[number];

/**
 * Per-type accepted filter fields for chain triggers, in validator key order.
 */
export const CHAIN_TRIGGER_FIELDS: Record<string, string[]> = {
	stx_transfer: ["sender", "recipient", "minAmount", "maxAmount"],
	stx_mint: ["recipient", "minAmount"],
	stx_burn: ["sender", "minAmount"],
	stx_lock: ["lockedAddress", "minAmount"],
	ft_transfer: ["assetIdentifier", "sender", "recipient", "minAmount", "trait"],
	ft_mint: ["assetIdentifier", "recipient", "minAmount", "trait"],
	ft_burn: ["assetIdentifier", "sender", "minAmount", "trait"],
	nft_transfer: ["assetIdentifier", "sender", "recipient", "trait"],
	nft_mint: ["assetIdentifier", "recipient", "trait"],
	nft_burn: ["assetIdentifier", "sender", "trait"],
	contract_call: ["contractId", "functionName", "caller", "trait"],
	contract_deploy: ["deployer", "contractName"],
	print_event: ["contractId", "topic", "trait", "where"],
	nested_contract_call: [
		"contractId",
		"functionName",
		"caller",
		"sender",
		"trait",
	],
	var_set: ["contractId", "varName", "trait"],
	map_set: ["contractId", "map", "trait"],
	map_insert: ["contractId", "map", "trait"],
	map_delete: ["contractId", "map", "trait"],
	sbtc_deposit: [
		"sender",
		"minAmount",
		"maxAmount",
		"bitcoinTxid",
		"requestId",
	],
	sbtc_withdrawal_create: ["sender", "minAmount", "maxAmount", "requestId"],
	sbtc_withdrawal_accept: ["requestId", "sweepTxid"],
	sbtc_withdrawal_reject: ["requestId"],
	sbtc_withdrawal_swept_confirmed: ["requestId", "sweepTxid"],
	rune_etch: ["rune"],
	rune_mint: ["rune"],
	rune_transfer: ["rune", "address", "minAmount"],
	rune_burn: ["rune"],
};
