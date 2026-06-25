import type { AbiContract } from "../../clarity/abi/index.ts";

/**
 * ABI for the reference `spv-adapter` contract — a thin, read-only wrapper that
 * exposes the SIP-044 Bitcoin built-ins (callable only from within a Clarity
 * contract) over read-only RPC. Plan 013 deploys a contract matching this shape;
 * `bitcoinVerifier` binds to it (or to an integrator's own contract with the
 * same surface).
 *
 * Hashes are internal (raw) byte order — the same as the built-ins. Do NOT
 * reverse before calling.
 */
export const SPV_ADAPTER_ABI = {
	functions: [
		{
			// (get-bitcoin-tx-output? tx vout)
			name: "get-tx-output",
			access: "read-only",
			args: [
				{ name: "tx", type: { buff: { length: 4096 } } },
				{ name: "vout", type: "uint128" },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "script", type: { buff: { length: 1024 } } },
							{ name: "amount", type: "uint128" },
							{ name: "txid", type: { buff: { length: 32 } } },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			// (verify-merkle-proof leaf-hash root-hash tx-index tx-count sibling-hashes)
			name: "verify-merkle",
			access: "read-only",
			args: [
				{ name: "leaf", type: { buff: { length: 32 } } },
				{ name: "root", type: { buff: { length: 32 } } },
				{ name: "tx-index", type: "uint128" },
				{ name: "tx-count", type: "uint128" },
				{
					name: "siblings",
					type: { list: { type: { buff: { length: 32 } }, length: 24 } },
				},
			],
			outputs: "bool",
		},
		{
			// (get-burn-block-info? header-hash burn-height) — authenticate a header → its root
			name: "get-header-merkle-root",
			access: "read-only",
			args: [{ name: "burn-height", type: "uint128" }],
			outputs: { optional: { buff: { length: 32 } } },
		},
	],
} as const satisfies AbiContract;
