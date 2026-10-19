import type { AbiContract } from "../clarity/abi/contract.ts";

/**
 * Minimal read-only ABI for `sbtc-token`.
 *
 * Only covers the SIP-010 fungible-token getters needed for supply / balance
 * queries. Public mutating functions are intentionally omitted; the data plane
 * doesn't sign sBTC token transfers itself, and the dataset captures
 * mutation effects through SIP-005 token events on the indexer side.
 */
export const SBTC_TOKEN_ABI = {
	functions: [
		{
			name: "get-name",
			access: "read-only",
			args: [],
			outputs: {
				response: { ok: { "string-ascii": { length: 32 } }, error: "none" },
			},
		},
		{
			name: "get-symbol",
			access: "read-only",
			args: [],
			outputs: {
				response: { ok: { "string-ascii": { length: 10 } }, error: "none" },
			},
		},
		{
			name: "get-decimals",
			access: "read-only",
			args: [],
			outputs: { response: { ok: "uint128", error: "none" } },
		},
		{
			name: "get-total-supply",
			access: "read-only",
			args: [],
			outputs: { response: { ok: "uint128", error: "none" } },
		},
		{
			name: "get-balance",
			access: "read-only",
			args: [{ name: "owner", type: "principal" }],
			outputs: { response: { ok: "uint128", error: "none" } },
		},
		{
			name: "get-token-uri",
			access: "read-only",
			args: [],
			outputs: {
				response: {
					ok: { optional: { "string-utf8": { length: 256 } } },
					error: "none",
				},
			},
		},
	],
} as const satisfies AbiContract;

/**
 * Minimal read-only ABI for `sbtc-registry`.
 *
 * The current signer-set getters — the inputs to deriving the signers' peg
 * address (v1: the aggregate pubkey; v2: the signer set and threshold).
 * Verified against the deployed mainnet contract interface.
 */
export const SBTC_REGISTRY_ABI = {
	functions: [
		{
			name: "get-current-aggregate-pubkey",
			access: "read-only",
			args: [],
			outputs: { buff: { length: 33 } },
		},
		{
			name: "get-current-signer-data",
			access: "read-only",
			args: [],
			outputs: {
				tuple: [
					{
						name: "current-aggregate-pubkey",
						type: { buff: { length: 33 } },
					},
					{ name: "current-signature-threshold", type: "uint128" },
					{ name: "current-signer-principal", type: "principal" },
					{
						name: "current-signer-set",
						type: { list: { type: { buff: { length: 33 } }, length: 128 } },
					},
				],
			},
		},
	],
} as const satisfies AbiContract;
