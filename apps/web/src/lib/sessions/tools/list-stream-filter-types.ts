import { tool } from "ai";
import { z } from "zod";

/**
 * Returns the full catalogue of stream filter types the agent can emit when
 * calling scaffold_stream. Kept out of the system prompt so prompt tokens
 * stay bounded — the agent only fetches this when it's actually about to
 * scaffold a stream.
 */
const FILTER_TYPES = [
	{
		type: "stx_transfer",
		description: "Fires on STX transfers between principals.",
		optionalParams: ["sender", "recipient", "minAmount", "maxAmount"],
		example: { type: "stx_transfer", minAmount: 1_000_000_000 },
	},
	{
		type: "stx_mint",
		description: "Fires on STX mint operations (rewards, coinbase, etc).",
		optionalParams: ["recipient", "minAmount"],
		example: { type: "stx_mint", minAmount: 1_000_000 },
	},
	{
		type: "stx_burn",
		description: "Fires on STX burn operations.",
		optionalParams: ["sender", "minAmount"],
		example: { type: "stx_burn", minAmount: 1_000_000 },
	},
	{
		type: "stx_lock",
		description: "Fires when STX gets locked (e.g. stacking).",
		optionalParams: ["lockedAddress", "minAmount"],
		example: { type: "stx_lock" },
	},
	{
		type: "ft_transfer",
		description:
			"Fires on SIP-010 fungible-token transfers. Use assetIdentifier to scope to a specific token.",
		optionalParams: ["sender", "recipient", "assetIdentifier", "minAmount"],
		example: {
			type: "ft_transfer",
			assetIdentifier:
				"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
		},
	},
	{
		type: "ft_mint",
		description: "Fires on SIP-010 fungible-token mints.",
		optionalParams: ["recipient", "assetIdentifier", "minAmount"],
		example: { type: "ft_mint", assetIdentifier: "SP2…token::TKN" },
	},
	{
		type: "ft_burn",
		description: "Fires on SIP-010 fungible-token burns.",
		optionalParams: ["sender", "assetIdentifier", "minAmount"],
		example: { type: "ft_burn", assetIdentifier: "SP2…token::TKN" },
	},
	{
		type: "nft_transfer",
		description: "Fires on SIP-009 NFT transfers. Scope with assetIdentifier.",
		optionalParams: ["sender", "recipient", "assetIdentifier", "tokenId"],
		example: {
			type: "nft_transfer",
			assetIdentifier: "SP000000000000000000002Q6VF78.bns::names",
		},
	},
	{
		type: "nft_mint",
		description: "Fires on SIP-009 NFT mints.",
		optionalParams: ["recipient", "assetIdentifier", "tokenId"],
		example: {
			type: "nft_mint",
			assetIdentifier: "SP000000000000000000002Q6VF78.bns::names",
		},
	},
	{
		type: "nft_burn",
		description: "Fires on SIP-009 NFT burns.",
		optionalParams: ["sender", "assetIdentifier", "tokenId"],
		example: { type: "nft_burn", assetIdentifier: "SP2…nft::name" },
	},
	{
		type: "contract_call",
		description:
			"Fires on any call to a contract function. Scope with contractId + functionName (wildcards OK).",
		optionalParams: ["contractId", "functionName", "caller"],
		example: {
			type: "contract_call",
			contractId: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01",
			functionName: "swap-x-for-y",
		},
	},
	{
		type: "contract_deploy",
		description: "Fires when a contract is deployed.",
		optionalParams: ["deployer", "contractName"],
		example: { type: "contract_deploy", contractName: "*token*" },
	},
	{
		type: "print_event",
		description:
			"Fires on contract `print` events. Scope with contractId + topic to catch a specific custom event.",
		optionalParams: ["contractId", "topic", "contains"],
		example: {
			type: "print_event",
			contractId: "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01",
			topic: "swap",
		},
	},
];

export const listStreamFilterTypes = tool({
	description:
		"List the 13 stream filter types with their optional params and example fixtures. Call this BEFORE scaffold_stream when you're not sure which filter fits the user's intent. Returns a static catalogue — no network or DB calls.",
	inputSchema: z.object({}),
	execute: async () => ({ filterTypes: FILTER_TYPES }),
});
