/**
 * Curated pox-5 ABI — the 25 functions this module calls, subset of the full
 * boot-contract interface (88 functions). Regenerate when stacks-core bumps
 * pox-5: `bun spike/pox5-getContract/extract-abi.ts`, then re-curate.
 * Drift-guarded by __tests__/actions.simnet.test.ts.
 */
import type { AbiContract } from "../clarity/abi/contract.ts";

const optionalSignerCalldata = {
	optional: { buff: { length: 500 } },
} as const;

const earnedRewardsTuple = {
	tuple: [
		{ name: "earned", type: "uint128" },
		{ name: "rewards-per-token", type: "uint128" },
	],
} as const;

const l1LockupOutputTuple = {
	tuple: [
		{ name: "amount", type: "uint128" },
		{ name: "header", type: { buff: { length: 80 } } },
		{ name: "height", type: "uint128" },
		{
			name: "leaf-hashes",
			type: { list: { type: { buff: { length: 32 } }, length: 14 } },
		},
		{ name: "output-index", type: "uint128" },
		{ name: "tx", type: { buff: { length: 100000 } } },
		{ name: "tx-count", type: "uint128" },
		{ name: "tx-index", type: "uint128" },
		{ name: "unlock-burn-height", type: "uint128" },
	],
} as const;

export const POX5_ABI = {
	functions: [
		// Read-only
		{
			name: "current-pox-reward-cycle",
			access: "read-only",
			args: [],
			outputs: "uint128",
		},
		{
			name: "get-bond-allowance",
			access: "read-only",
			args: [
				{ name: "bond-index", type: "uint128" },
				{ name: "staker", type: "principal" },
			],
			outputs: { optional: "uint128" },
		},
		{
			name: "get-bond-l1-unlock-height",
			access: "read-only",
			args: [{ name: "bond-index", type: "uint128" }],
			outputs: "uint128",
		},
		{
			name: "get-bond-membership",
			access: "read-only",
			args: [{ name: "staker", type: "principal" }],
			outputs: {
				optional: {
					tuple: [
						{ name: "amount-sats", type: "uint128" },
						{ name: "amount-ustx", type: "uint128" },
						{ name: "bond-index", type: "uint128" },
						{ name: "is-l1-lock", type: "bool" },
						{ name: "signer", type: "principal" },
					],
				},
			},
		},
		{
			name: "get-first-pox-5-reward-cycle",
			access: "read-only",
			args: [],
			outputs: "uint128",
		},
		{
			name: "get-protocol-bond",
			access: "read-only",
			args: [{ name: "bond-index", type: "uint128" }],
			outputs: {
				optional: {
					tuple: [
						{ name: "early-unlock-bytes", type: { buff: { length: 683 } } },
						{ name: "min-ustx-ratio", type: "uint128" },
						{ name: "stx-value-ratio", type: "uint128" },
						{ name: "target-rate", type: "uint128" },
					],
				},
			},
		},
		{
			name: "get-signer-info",
			access: "read-only",
			args: [{ name: "signer", type: "principal" }],
			outputs: { optional: { buff: { length: 33 } } },
		},
		{
			name: "get-staker-custodied-sbtc",
			access: "read-only",
			args: [{ name: "staker", type: "principal" }],
			outputs: "uint128",
		},
		{
			name: "get-staker-info",
			access: "read-only",
			args: [{ name: "staker", type: "principal" }],
			outputs: {
				optional: {
					tuple: [
						{ name: "amount-ustx", type: "uint128" },
						{ name: "first-reward-cycle", type: "uint128" },
						{ name: "num-cycles", type: "uint128" },
						{ name: "signer", type: "principal" },
					],
				},
			},
		},
		{
			name: "get-total-sbtc-staked-for-bond",
			access: "read-only",
			args: [{ name: "bond-index", type: "uint128" }],
			outputs: "uint128",
		},
		{
			name: "has-announced-l1-early-exit",
			access: "read-only",
			args: [
				{ name: "bond-index", type: "uint128" },
				{ name: "staker", type: "principal" },
			],
			outputs: "bool",
		},
		{
			name: "verify-signer-key-grant",
			access: "read-only",
			args: [
				{ name: "signer-manager", type: "principal" },
				{ name: "signer-key", type: { buff: { length: 33 } } },
			],
			outputs: { response: { ok: "bool", error: "uint128" } },
		},

		// Public
		{
			name: "announce-l1-early-exit",
			access: "public",
			args: [
				{ name: "staker", type: "principal" },
				{ name: "old-signer-manager", type: "trait_reference" },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "amount-sats-released", type: "uint128" },
							{ name: "bond-index", type: "uint128" },
							{ name: "signer", type: "principal" },
							{ name: "staker", type: "principal" },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "calculate-rewards",
			access: "public",
			args: [
				{
					name: "bond-periods",
					type: { list: { type: "uint128", length: 6 } },
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "accrued-rewards-per-ustx", type: "uint128" },
							{
								name: "bond-periods",
								type: { list: { type: "uint128", length: 6 } },
							},
							{ name: "calculation-height", type: "uint128" },
							{ name: "cumulative-rewards-per-ustx", type: "uint128" },
							{ name: "cycle-staked-ustx", type: "uint128" },
							{ name: "gross-accrued-rewards", type: "uint128" },
							{ name: "reserve-balance", type: "uint128" },
							{ name: "reserve-deposit", type: "uint128" },
							{ name: "stx-cycle", type: "uint128" },
							{ name: "total-bond-rewards", type: "uint128" },
							{ name: "total-stx-staker-rewards", type: "uint128" },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "claim-rewards",
			access: "public",
			args: [
				{
					name: "bond-periods",
					type: { list: { type: "uint128", length: 6 } },
				},
				{ name: "reward-cycle", type: "uint128" },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "bond-rewards",
								type: {
									list: {
										type: {
											tuple: [
												{ name: "bond-index", type: "uint128" },
												{ name: "earned", type: "uint128" },
												{ name: "rewards-per-token", type: "uint128" },
											],
										},
										length: 6,
									},
								},
							},
							{ name: "bond-totals", type: "uint128" },
							{ name: "stx-rewards", type: earnedRewardsTuple },
							{ name: "total-rewards", type: "uint128" },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "claim-staker-rewards-for-signer",
			access: "public",
			args: [
				{ name: "staker", type: "principal" },
				{ name: "reward-cycle", type: "uint128" },
				{ name: "bond-index", type: { optional: "uint128" } },
			],
			outputs: {
				response: { ok: earnedRewardsTuple, error: "uint128" },
			},
		},
		{
			name: "grant-signer-key",
			access: "public",
			args: [
				{ name: "signer-key", type: { buff: { length: 33 } } },
				{ name: "signer-manager", type: "principal" },
				{ name: "auth-id", type: "uint128" },
				{ name: "signer-sig", type: { buff: { length: 65 } } },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "auth-id", type: "uint128" },
							{ name: "signer-key", type: { buff: { length: 33 } } },
							{ name: "signer-manager", type: "principal" },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "register-for-bond",
			access: "public",
			args: [
				{ name: "bond-index", type: "uint128" },
				{ name: "signer-manager", type: "trait_reference" },
				{ name: "amount-ustx", type: "uint128" },
				{
					name: "btc-lockup",
					type: {
						response: {
							ok: {
								tuple: [
									{
										name: "outputs",
										type: { list: { type: l1LockupOutputTuple, length: 10 } },
									},
									{
										name: "staker-unlock-bytes",
										type: { buff: { length: 683 } },
									},
								],
							},
							error: "uint128",
						},
					},
				},
				{ name: "signer-calldata", type: optionalSignerCalldata },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "amount-ustx", type: "uint128" },
							{ name: "bond-index", type: "uint128" },
							{
								name: "btc-lockup",
								type: {
									tuple: [
										{
											name: "txs",
											type: {
												optional: {
													list: {
														type: {
															tuple: [
																{ name: "output-index", type: "uint128" },
																{
																	name: "txid",
																	type: { buff: { length: 32 } },
																},
															],
														},
														length: 10,
													},
												},
											},
										},
										{
											name: "type",
											type: { "string-ascii": { length: 2 } },
										},
									],
								},
							},
							{ name: "first-reward-cycle", type: "uint128" },
							{ name: "is-l1-lock", type: "bool" },
							{ name: "sats-total", type: "uint128" },
							{ name: "signer", type: "principal" },
							{ name: "staker", type: "principal" },
							{ name: "unlock-burn-height", type: "uint128" },
							{ name: "unlock-cycle", type: "uint128" },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "revoke-signer-grant",
			access: "public",
			args: [
				{ name: "signer-manager", type: "principal" },
				{ name: "signer-key", type: { buff: { length: 33 } } },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "existed", type: "bool" },
							{ name: "signer-key", type: { buff: { length: 33 } } },
							{ name: "signer-manager", type: "principal" },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "setup-bond",
			access: "public",
			args: [
				{ name: "bond-index", type: "uint128" },
				{ name: "target-rate", type: "uint128" },
				{ name: "stx-value-ratio", type: "uint128" },
				{ name: "min-ustx-ratio", type: "uint128" },
				{ name: "early-unlock-bytes", type: { buff: { length: 683 } } },
				{
					name: "allowlist",
					type: {
						list: {
							type: {
								tuple: [
									{ name: "max-sats", type: "uint128" },
									{ name: "staker", type: "principal" },
								],
							},
							length: 1000,
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "bond-index", type: "uint128" },
							{
								name: "early-unlock-bytes",
								type: { buff: { length: 683 } },
							},
							{ name: "max-allocation-sats", type: "uint128" },
							{ name: "min-ustx-ratio", type: "uint128" },
							{ name: "stx-value-ratio", type: "uint128" },
							{ name: "target-rate", type: "uint128" },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "stake",
			access: "public",
			args: [
				{ name: "signer-manager", type: "trait_reference" },
				{ name: "amount-ustx", type: "uint128" },
				{ name: "num-cycles", type: "uint128" },
				{ name: "start-burn-ht", type: "uint128" },
				{ name: "signer-calldata", type: optionalSignerCalldata },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "amount-ustx", type: "uint128" },
							{ name: "first-reward-cycle", type: "uint128" },
							{ name: "num-cycles", type: "uint128" },
							{ name: "signer", type: "principal" },
							{ name: "staker", type: "principal" },
							{ name: "unlock-burn-height", type: "uint128" },
							{ name: "unlock-cycle", type: "uint128" },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "stake-update",
			access: "public",
			args: [
				{ name: "signer-manager", type: "trait_reference" },
				{ name: "old-signer-manager", type: "trait_reference" },
				{ name: "cycles-to-extend", type: "uint128" },
				{ name: "amount-increase", type: "uint128" },
				{ name: "signer-calldata", type: optionalSignerCalldata },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "amount-increase", type: "uint128" },
							{ name: "amount-ustx", type: "uint128" },
							{ name: "cycles-to-extend", type: "uint128" },
							{ name: "num-cycles", type: "uint128" },
							{ name: "old-signer", type: "principal" },
							{ name: "prev-unlock-height", type: "uint128" },
							{ name: "signer", type: "principal" },
							{ name: "staker", type: "principal" },
							{ name: "unlock-burn-height", type: "uint128" },
							{ name: "unlock-cycle", type: "uint128" },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "unstake",
			access: "public",
			args: [{ name: "old-signer-manager", type: "trait_reference" }],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "amount-ustx", type: "uint128" },
							{ name: "first-reward-cycle", type: "uint128" },
							{ name: "signer", type: "principal" },
							{ name: "staker", type: "principal" },
							{ name: "unlock-burn-height", type: "uint128" },
							{ name: "unlock-cycle", type: "uint128" },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "unstake-sbtc",
			access: "public",
			args: [
				{ name: "signer-manager", type: "trait_reference" },
				{ name: "amount-to-withdrawal-sats", type: "uint128" },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "amount-withdrawn-sats", type: "uint128" },
							{ name: "bond-index", type: "uint128" },
							{ name: "new-amount-sats", type: "uint128" },
							{ name: "signer", type: "principal" },
							{ name: "staker", type: "principal" },
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "update-bond-registration",
			access: "public",
			args: [
				{ name: "signer-manager", type: "trait_reference" },
				{ name: "old-signer-manager", type: "trait_reference" },
				{ name: "signer-calldata", type: optionalSignerCalldata },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "amount-sats", type: "uint128" },
							{ name: "amount-ustx", type: "uint128" },
							{ name: "bond-index", type: "uint128" },
							{ name: "first-reward-cycle", type: "uint128" },
							{ name: "is-l1-lock", type: "bool" },
							{ name: "num-cycles", type: "uint128" },
							{ name: "old-signer", type: "principal" },
							{ name: "signer", type: "principal" },
							{ name: "staker", type: "principal" },
						],
					},
					error: "uint128",
				},
			},
		},
	],
} as const satisfies AbiContract;
