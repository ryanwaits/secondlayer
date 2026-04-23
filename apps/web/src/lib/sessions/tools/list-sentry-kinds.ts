import { tool } from "ai";
import { z } from "zod";

/**
 * Enumerate available sentry kinds with their config fields. Use this
 * before proposing a create so the user can pick a kind and you know
 * which fields to ask them to fill out.
 *
 * Kept static (mirrors SDK `sentries.listKinds()`) so agents get the
 * same info whether they're in chat or calling MCP.
 */
const KINDS = [
	{
		kind: "large-outflow",
		displayName: "Large outflow",
		description:
			"Watch for STX transfers above a threshold to/from a principal (treasury watch, whale alerts).",
		requiredFields: {
			principal: "Stacks principal (SP/SM/ST... optionally .contract)",
			thresholdMicroStx:
				"µSTX threshold as decimal string — e.g. '100000000000' for 100,000 STX",
		},
		example: {
			principal: "SP000000000000000000002Q6VF78",
			thresholdMicroStx: "100000000000",
		},
	},
	{
		kind: "permission-change",
		displayName: "Permission change",
		description:
			"Alert on successful calls to admin functions on a contract (role rotation, ownership transfer, takeover).",
		requiredFields: {
			principal: "Contract principal (SP....contract-name)",
			adminFunctions:
				"Array of function names — e.g. ['set-owner', 'set-admin']",
		},
		example: {
			principal: "SP000000000000000000002Q6VF78.my-contract",
			adminFunctions: ["set-owner", "set-admin", "transfer-ownership"],
		},
	},
	{
		kind: "ft-outflow",
		displayName: "FT outflow",
		description:
			"Watch for SIP-010 token transfers above a threshold involving a principal (token drain detection).",
		requiredFields: {
			principal: "Stacks principal",
			assetIdentifier: "Full asset id — e.g. 'SP....token-name::token-symbol'",
			thresholdAmount:
				"Raw token amount (pre-decimal) as string — e.g. '1000000'",
		},
		example: {
			principal: "SP000000000000000000002Q6VF78",
			assetIdentifier: "SP...CONTRACT.my-token::my-token",
			thresholdAmount: "1000000",
		},
	},
	{
		kind: "contract-deployment",
		displayName: "Contract deployment",
		description:
			"Alert when a principal deploys a new smart contract (supply-chain / vault-drain vector).",
		requiredFields: {
			principal: "Deployer principal (address only, no .contract suffix)",
		},
		example: {
			principal: "SP000000000000000000002Q6VF78",
		},
	},
	{
		kind: "print-event-match",
		displayName: "Print event match",
		description:
			"Alert on specific (contract, topic) print events — custom DeFi alerts for liquidations, drains, governance, etc.",
		requiredFields: {
			principal: "Contract principal (SP....contract-name)",
			topic:
				"Topic string to match, or null to match all prints on the contract (noisy)",
		},
		example: {
			principal: "SP....lending-pool",
			topic: "liquidation",
		},
	},
];

export const listSentryKinds = tool({
	description:
		"List the available sentry kinds with their required config fields + examples. Call this first when a user asks to create a sentry so you know what to ask them.",
	inputSchema: z.object({}),
	execute: async () => {
		return { kinds: KINDS };
	},
});
