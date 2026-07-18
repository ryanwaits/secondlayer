// Auto-extracted from Clarinet simnet (SP000000000000000000002Q6VF78.pox-5). st-013 spike.
import type { AbiContract } from "../../packages/stacks/src/clarity/abi/contract.ts";

export const POX5_ABI = {
	functions: [
		{
			name: "announce-l1-early-exit",
			access: "public",
			args: [
				{
					name: "staker",
					type: "principal",
				},
				{
					name: "old-signer-manager",
					type: "trait_reference",
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "amount-sats-released",
								type: "uint128",
							},
							{
								name: "bond-index",
								type: "uint128",
							},
							{
								name: "signer",
								type: "principal",
							},
							{
								name: "staker",
								type: "principal",
							},
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
					type: {
						list: {
							type: "uint128",
							length: 6,
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "accrued-rewards-per-ustx",
								type: "uint128",
							},
							{
								name: "bond-periods",
								type: {
									list: {
										type: "uint128",
										length: 6,
									},
								},
							},
							{
								name: "calculation-height",
								type: "uint128",
							},
							{
								name: "cumulative-rewards-per-ustx",
								type: "uint128",
							},
							{
								name: "cycle-staked-ustx",
								type: "uint128",
							},
							{
								name: "gross-accrued-rewards",
								type: "uint128",
							},
							{
								name: "reserve-balance",
								type: "uint128",
							},
							{
								name: "reserve-deposit",
								type: "uint128",
							},
							{
								name: "stx-cycle",
								type: "uint128",
							},
							{
								name: "total-bond-rewards",
								type: "uint128",
							},
							{
								name: "total-stx-staker-rewards",
								type: "uint128",
							},
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
					type: {
						list: {
							type: "uint128",
							length: 6,
						},
					},
				},
				{
					name: "reward-cycle",
					type: "uint128",
				},
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
												{
													name: "bond-index",
													type: "uint128",
												},
												{
													name: "earned",
													type: "uint128",
												},
												{
													name: "rewards-per-token",
													type: "uint128",
												},
											],
										},
										length: 6,
									},
								},
							},
							{
								name: "bond-totals",
								type: "uint128",
							},
							{
								name: "stx-rewards",
								type: {
									tuple: [
										{
											name: "earned",
											type: "uint128",
										},
										{
											name: "rewards-per-token",
											type: "uint128",
										},
									],
								},
							},
							{
								name: "total-rewards",
								type: "uint128",
							},
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
				{
					name: "staker",
					type: "principal",
				},
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "earned",
								type: "uint128",
							},
							{
								name: "rewards-per-token",
								type: "uint128",
							},
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "grant-signer-key",
			access: "public",
			args: [
				{
					name: "signer-key",
					type: {
						buff: {
							length: 33,
						},
					},
				},
				{
					name: "signer-manager",
					type: "principal",
				},
				{
					name: "auth-id",
					type: "uint128",
				},
				{
					name: "signer-sig",
					type: {
						buff: {
							length: 65,
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "auth-id",
								type: "uint128",
							},
							{
								name: "signer-key",
								type: {
									buff: {
										length: 33,
									},
								},
							},
							{
								name: "signer-manager",
								type: "principal",
							},
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "pause-rewards",
			access: "public",
			args: [],
			outputs: {
				response: {
					ok: "bool",
					error: "uint128",
				},
			},
		},
		{
			name: "register-for-bond",
			access: "public",
			args: [
				{
					name: "bond-index",
					type: "uint128",
				},
				{
					name: "signer-manager",
					type: "trait_reference",
				},
				{
					name: "amount-ustx",
					type: "uint128",
				},
				{
					name: "btc-lockup",
					type: {
						response: {
							ok: {
								tuple: [
									{
										name: "outputs",
										type: {
											list: {
												type: {
													tuple: [
														{
															name: "amount",
															type: "uint128",
														},
														{
															name: "header",
															type: {
																buff: {
																	length: 80,
																},
															},
														},
														{
															name: "height",
															type: "uint128",
														},
														{
															name: "leaf-hashes",
															type: {
																list: {
																	type: {
																		buff: {
																			length: 32,
																		},
																	},
																	length: 14,
																},
															},
														},
														{
															name: "output-index",
															type: "uint128",
														},
														{
															name: "tx",
															type: {
																buff: {
																	length: 100000,
																},
															},
														},
														{
															name: "tx-count",
															type: "uint128",
														},
														{
															name: "tx-index",
															type: "uint128",
														},
														{
															name: "unlock-burn-height",
															type: "uint128",
														},
													],
												},
												length: 10,
											},
										},
									},
									{
										name: "staker-unlock-bytes",
										type: {
											buff: {
												length: 683,
											},
										},
									},
								],
							},
							error: "uint128",
						},
					},
				},
				{
					name: "signer-calldata",
					type: {
						optional: {
							buff: {
								length: 500,
							},
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "amount-ustx",
								type: "uint128",
							},
							{
								name: "bond-index",
								type: "uint128",
							},
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
																{
																	name: "output-index",
																	type: "uint128",
																},
																{
																	name: "txid",
																	type: {
																		buff: {
																			length: 32,
																		},
																	},
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
											type: {
												"string-ascii": {
													length: 2,
												},
											},
										},
									],
								},
							},
							{
								name: "first-reward-cycle",
								type: "uint128",
							},
							{
								name: "is-l1-lock",
								type: "bool",
							},
							{
								name: "sats-total",
								type: "uint128",
							},
							{
								name: "signer",
								type: "principal",
							},
							{
								name: "staker",
								type: "principal",
							},
							{
								name: "unlock-burn-height",
								type: "uint128",
							},
							{
								name: "unlock-cycle",
								type: "uint128",
							},
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "register-signer",
			access: "public",
			args: [
				{
					name: "signer-manager",
					type: "trait_reference",
				},
				{
					name: "signer-key",
					type: {
						buff: {
							length: 33,
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "signer",
								type: "principal",
							},
							{
								name: "signer-key",
								type: {
									buff: {
										length: 33,
									},
								},
							},
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
				{
					name: "signer-manager",
					type: "principal",
				},
				{
					name: "signer-key",
					type: {
						buff: {
							length: 33,
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "existed",
								type: "bool",
							},
							{
								name: "signer-key",
								type: {
									buff: {
										length: 33,
									},
								},
							},
							{
								name: "signer-manager",
								type: "principal",
							},
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "set-bond-admin",
			access: "public",
			args: [
				{
					name: "new-admin",
					type: "principal",
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "new-admin",
								type: "principal",
							},
							{
								name: "old-admin",
								type: "principal",
							},
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "set-burnchain-parameters",
			access: "public",
			args: [
				{
					name: "first-burn-height",
					type: "uint128",
				},
				{
					name: "prepare-cycle-length",
					type: "uint128",
				},
				{
					name: "reward-cycle-length",
					type: "uint128",
				},
				{
					name: "begin-pox5-reward-cycle",
					type: "uint128",
				},
			],
			outputs: {
				response: {
					ok: "bool",
					error: "none",
				},
			},
		},
		{
			name: "set-pause-admin",
			access: "public",
			args: [
				{
					name: "new-admin",
					type: "principal",
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "new-admin",
								type: "principal",
							},
							{
								name: "old-admin",
								type: "principal",
							},
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
				{
					name: "bond-index",
					type: "uint128",
				},
				{
					name: "target-rate",
					type: "uint128",
				},
				{
					name: "stx-value-ratio",
					type: "uint128",
				},
				{
					name: "min-ustx-ratio",
					type: "uint128",
				},
				{
					name: "early-unlock-bytes",
					type: {
						buff: {
							length: 683,
						},
					},
				},
				{
					name: "allowlist",
					type: {
						list: {
							type: {
								tuple: [
									{
										name: "max-sats",
										type: "uint128",
									},
									{
										name: "staker",
										type: "principal",
									},
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
							{
								name: "bond-index",
								type: "uint128",
							},
							{
								name: "early-unlock-bytes",
								type: {
									buff: {
										length: 683,
									},
								},
							},
							{
								name: "max-allocation-sats",
								type: "uint128",
							},
							{
								name: "min-ustx-ratio",
								type: "uint128",
							},
							{
								name: "stx-value-ratio",
								type: "uint128",
							},
							{
								name: "target-rate",
								type: "uint128",
							},
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
				{
					name: "signer-manager",
					type: "trait_reference",
				},
				{
					name: "amount-ustx",
					type: "uint128",
				},
				{
					name: "num-cycles",
					type: "uint128",
				},
				{
					name: "start-burn-ht",
					type: "uint128",
				},
				{
					name: "signer-calldata",
					type: {
						optional: {
							buff: {
								length: 500,
							},
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "amount-ustx",
								type: "uint128",
							},
							{
								name: "first-reward-cycle",
								type: "uint128",
							},
							{
								name: "num-cycles",
								type: "uint128",
							},
							{
								name: "signer",
								type: "principal",
							},
							{
								name: "staker",
								type: "principal",
							},
							{
								name: "unlock-burn-height",
								type: "uint128",
							},
							{
								name: "unlock-cycle",
								type: "uint128",
							},
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
				{
					name: "signer-manager",
					type: "trait_reference",
				},
				{
					name: "old-signer-manager",
					type: "trait_reference",
				},
				{
					name: "cycles-to-extend",
					type: "uint128",
				},
				{
					name: "amount-increase",
					type: "uint128",
				},
				{
					name: "signer-calldata",
					type: {
						optional: {
							buff: {
								length: 500,
							},
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "amount-increase",
								type: "uint128",
							},
							{
								name: "amount-ustx",
								type: "uint128",
							},
							{
								name: "cycles-to-extend",
								type: "uint128",
							},
							{
								name: "num-cycles",
								type: "uint128",
							},
							{
								name: "old-signer",
								type: "principal",
							},
							{
								name: "prev-unlock-height",
								type: "uint128",
							},
							{
								name: "signer",
								type: "principal",
							},
							{
								name: "staker",
								type: "principal",
							},
							{
								name: "unlock-burn-height",
								type: "uint128",
							},
							{
								name: "unlock-cycle",
								type: "uint128",
							},
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "unstake",
			access: "public",
			args: [
				{
					name: "old-signer-manager",
					type: "trait_reference",
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "amount-ustx",
								type: "uint128",
							},
							{
								name: "first-reward-cycle",
								type: "uint128",
							},
							{
								name: "signer",
								type: "principal",
							},
							{
								name: "staker",
								type: "principal",
							},
							{
								name: "unlock-burn-height",
								type: "uint128",
							},
							{
								name: "unlock-cycle",
								type: "uint128",
							},
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
				{
					name: "signer-manager",
					type: "trait_reference",
				},
				{
					name: "amount-to-withdrawal-sats",
					type: "uint128",
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "amount-withdrawn-sats",
								type: "uint128",
							},
							{
								name: "bond-index",
								type: "uint128",
							},
							{
								name: "new-amount-sats",
								type: "uint128",
							},
							{
								name: "signer",
								type: "principal",
							},
							{
								name: "staker",
								type: "principal",
							},
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
				{
					name: "signer-manager",
					type: "trait_reference",
				},
				{
					name: "old-signer-manager",
					type: "trait_reference",
				},
				{
					name: "signer-calldata",
					type: {
						optional: {
							buff: {
								length: 500,
							},
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "amount-sats",
								type: "uint128",
							},
							{
								name: "amount-ustx",
								type: "uint128",
							},
							{
								name: "bond-index",
								type: "uint128",
							},
							{
								name: "first-reward-cycle",
								type: "uint128",
							},
							{
								name: "is-l1-lock",
								type: "bool",
							},
							{
								name: "num-cycles",
								type: "uint128",
							},
							{
								name: "old-signer",
								type: "principal",
							},
							{
								name: "signer",
								type: "principal",
							},
							{
								name: "staker",
								type: "principal",
							},
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "assert-all-active-bonds-included",
			access: "read-only",
			args: [
				{
					name: "bond-periods",
					type: {
						list: {
							type: "uint128",
							length: 6,
						},
					},
				},
				{
					name: "calculation-height",
					type: "uint128",
				},
			],
			outputs: {
				response: {
					ok: "bool",
					error: "uint128",
				},
			},
		},
		{
			name: "bond-overlaps-new-position?",
			access: "read-only",
			args: [
				{
					name: "existing-membership",
					type: {
						optional: {
							tuple: [
								{
									name: "amount-sats",
									type: "uint128",
								},
								{
									name: "amount-ustx",
									type: "uint128",
								},
								{
									name: "bond-index",
									type: "uint128",
								},
								{
									name: "is-l1-lock",
									type: "bool",
								},
								{
									name: "signer",
									type: "principal",
								},
							],
						},
					},
				},
				{
					name: "new-first-reward-cycle",
					type: "uint128",
				},
			],
			outputs: "bool",
		},
		{
			name: "bond-period-to-burn-height",
			access: "read-only",
			args: [
				{
					name: "bond-index",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "bond-period-to-reward-cycle",
			access: "read-only",
			args: [
				{
					name: "bond-index",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "burn-height-to-distribution-index",
			access: "read-only",
			args: [
				{
					name: "height",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "burn-height-to-reward-cycle",
			access: "read-only",
			args: [
				{
					name: "height",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "check-pox-lock-period",
			access: "read-only",
			args: [
				{
					name: "lock-period",
					type: "uint128",
				},
			],
			outputs: "bool",
		},
		{
			name: "clamp",
			access: "read-only",
			args: [
				{
					name: "value",
					type: "uint128",
				},
				{
					name: "min",
					type: "uint128",
				},
				{
					name: "max",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "compute-earned-rewards",
			access: "read-only",
			args: [
				{
					name: "shares",
					type: "uint128",
				},
				{
					name: "rpt-current",
					type: "uint128",
				},
				{
					name: "rpt-paid",
					type: "uint128",
				},
				{
					name: "pending",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "construct-lockup-output-script",
			access: "read-only",
			args: [
				{
					name: "staker",
					type: "principal",
				},
				{
					name: "unlock-burn-height",
					type: "uint128",
				},
				{
					name: "staker-unlock-bytes",
					type: {
						buff: {
							length: 683,
						},
					},
				},
				{
					name: "early-unlock-bytes",
					type: {
						buff: {
							length: 683,
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						buff: {
							length: 34,
						},
					},
					error: "uint128",
				},
			},
		},
		{
			name: "construct-lockup-script",
			access: "read-only",
			args: [
				{
					name: "staker",
					type: "principal",
				},
				{
					name: "unlock-burn-height",
					type: "uint128",
				},
				{
					name: "staker-unlock-bytes",
					type: {
						buff: {
							length: 683,
						},
					},
				},
				{
					name: "early-unlock-bytes",
					type: {
						buff: {
							length: 683,
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						buff: {
							length: 2437,
						},
					},
					error: "uint128",
				},
			},
		},
		{
			name: "current-distribution-cycle",
			access: "read-only",
			args: [],
			outputs: "uint128",
		},
		{
			name: "current-pox-reward-cycle",
			access: "read-only",
			args: [],
			outputs: "uint128",
		},
		{
			name: "distribution-cycle-to-burn-height",
			access: "read-only",
			args: [
				{
					name: "cycle",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-amount-delegated-for-signer",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "cycle",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-bc-h-hash",
			access: "read-only",
			args: [
				{
					name: "bh",
					type: "uint128",
				},
			],
			outputs: {
				optional: {
					buff: {
						length: 32,
					},
				},
			},
		},
		{
			name: "get-bond-allowance",
			access: "read-only",
			args: [
				{
					name: "bond-index",
					type: "uint128",
				},
				{
					name: "staker",
					type: "principal",
				},
			],
			outputs: {
				optional: "uint128",
			},
		},
		{
			name: "get-bond-l1-unlock-height",
			access: "read-only",
			args: [
				{
					name: "bond-index",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-bond-membership",
			access: "read-only",
			args: [
				{
					name: "staker",
					type: "principal",
				},
			],
			outputs: {
				optional: {
					tuple: [
						{
							name: "amount-sats",
							type: "uint128",
						},
						{
							name: "amount-ustx",
							type: "uint128",
						},
						{
							name: "bond-index",
							type: "uint128",
						},
						{
							name: "is-l1-lock",
							type: "bool",
						},
						{
							name: "signer",
							type: "principal",
						},
					],
				},
			},
		},
		{
			name: "get-earned",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-earned-staker-rewards",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
				{
					name: "staker",
					type: "principal",
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-first-pox-5-reward-cycle",
			access: "read-only",
			args: [],
			outputs: "uint128",
		},
		{
			name: "get-last-accounted-rewards-only",
			access: "read-only",
			args: [],
			outputs: "uint128",
		},
		{
			name: "get-last-reward-compute-height",
			access: "read-only",
			args: [],
			outputs: "uint128",
		},
		{
			name: "get-new-rewards",
			access: "read-only",
			args: [],
			outputs: "uint128",
		},
		{
			name: "get-pox-info",
			access: "read-only",
			args: [],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "first-burnchain-block-height",
								type: "uint128",
							},
							{
								name: "min-amount-ustx",
								type: "uint128",
							},
							{
								name: "prepare-cycle-length",
								type: "uint128",
							},
							{
								name: "reward-cycle-id",
								type: "uint128",
							},
							{
								name: "reward-cycle-length",
								type: "uint128",
							},
							{
								name: "total-liquid-supply-ustx",
								type: "uint128",
							},
						],
					},
					error: "none",
				},
			},
		},
		{
			name: "get-protocol-bond",
			access: "read-only",
			args: [
				{
					name: "bond-index",
					type: "uint128",
				},
			],
			outputs: {
				optional: {
					tuple: [
						{
							name: "early-unlock-bytes",
							type: {
								buff: {
									length: 683,
								},
							},
						},
						{
							name: "min-ustx-ratio",
							type: "uint128",
						},
						{
							name: "stx-value-ratio",
							type: "uint128",
						},
						{
							name: "target-rate",
							type: "uint128",
						},
					],
				},
			},
		},
		{
			name: "get-reserve-balance",
			access: "read-only",
			args: [],
			outputs: "uint128",
		},
		{
			name: "get-reversed-txid",
			access: "read-only",
			args: [
				{
					name: "tx",
					type: {
						buff: {
							length: 100000,
						},
					},
				},
			],
			outputs: {
				buff: {
					length: 32,
				},
			},
		},
		{
			name: "get-rewards",
			access: "read-only",
			args: [],
			outputs: "uint128",
		},
		{
			name: "get-rewards-per-token-for-cycle",
			access: "read-only",
			args: [
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-signer-cycle-membership",
			access: "read-only",
			args: [
				{
					name: "staker",
					type: "principal",
				},
				{
					name: "cycle",
					type: "uint128",
				},
			],
			outputs: {
				optional: {
					tuple: [
						{
							name: "amount-ustx",
							type: "uint128",
						},
						{
							name: "signer",
							type: "principal",
						},
					],
				},
			},
		},
		{
			name: "get-signer-grant-message-hash",
			access: "read-only",
			args: [
				{
					name: "signer-manager",
					type: "principal",
				},
				{
					name: "auth-id",
					type: "uint128",
				},
			],
			outputs: {
				buff: {
					length: 32,
				},
			},
		},
		{
			name: "get-signer-info",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
			],
			outputs: {
				optional: {
					buff: {
						length: 33,
					},
				},
			},
		},
		{
			name: "get-signer-pending-staked-ustx-per-cycle",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "cycle",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-signer-rewards-per-token-for-cycle",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-signer-rewards-per-token-settled-for-cycle",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-signer-set-first-item-for-cycle",
			access: "read-only",
			args: [
				{
					name: "cycle",
					type: "uint128",
				},
			],
			outputs: {
				optional: "principal",
			},
		},
		{
			name: "get-signer-set-item-for-cycle",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "cycle",
					type: "uint128",
				},
			],
			outputs: {
				optional: {
					tuple: [
						{
							name: "next",
							type: {
								optional: "principal",
							},
						},
						{
							name: "prev",
							type: {
								optional: "principal",
							},
						},
					],
				},
			},
		},
		{
			name: "get-signer-set-last-item-for-cycle",
			access: "read-only",
			args: [
				{
					name: "cycle",
					type: "uint128",
				},
			],
			outputs: {
				optional: "principal",
			},
		},
		{
			name: "get-signer-set-next-item-for-cycle",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "cycle",
					type: "uint128",
				},
			],
			outputs: {
				optional: "principal",
			},
		},
		{
			name: "get-signer-set-prev-item-for-cycle",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "cycle",
					type: "uint128",
				},
			],
			outputs: {
				optional: "principal",
			},
		},
		{
			name: "get-signer-shares-staked-for-cycle",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-signer-unclaimed-rewards-for-cycle",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-staker-custodied-sbtc",
			access: "read-only",
			args: [
				{
					name: "staker",
					type: "principal",
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-staker-info",
			access: "read-only",
			args: [
				{
					name: "staker",
					type: "principal",
				},
			],
			outputs: {
				optional: {
					tuple: [
						{
							name: "amount-ustx",
							type: "uint128",
						},
						{
							name: "first-reward-cycle",
							type: "uint128",
						},
						{
							name: "num-cycles",
							type: "uint128",
						},
						{
							name: "signer",
							type: "principal",
						},
					],
				},
			},
		},
		{
			name: "get-staker-rewards-per-token-settled-for-cycle",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
				{
					name: "staker",
					type: "principal",
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-staker-shares-staked-for-cycle",
			access: "read-only",
			args: [
				{
					name: "staker",
					type: "principal",
				},
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
				{
					name: "signer",
					type: "principal",
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-staker-unclaimed-rewards-for-cycle",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
				{
					name: "staker",
					type: "principal",
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-total-sbtc-staked",
			access: "read-only",
			args: [],
			outputs: "uint128",
		},
		{
			name: "get-total-sbtc-staked-for-bond",
			access: "read-only",
			args: [
				{
					name: "bond-index",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-total-shares-staked-for-cycle",
			access: "read-only",
			args: [
				{
					name: "reward-cycle",
					type: "uint128",
				},
				{
					name: "bond-index",
					type: {
						optional: "uint128",
					},
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-total-ustx-stacked",
			access: "read-only",
			args: [
				{
					name: "reward-cycle",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "get-ustx-delegated-for-cycle",
			access: "read-only",
			args: [
				{
					name: "reward-cycle",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "has-announced-l1-early-exit",
			access: "read-only",
			args: [
				{
					name: "bond-index",
					type: "uint128",
				},
				{
					name: "staker",
					type: "principal",
				},
			],
			outputs: "bool",
		},
		{
			name: "is-bond-active-at-height",
			access: "read-only",
			args: [
				{
					name: "bond-index",
					type: "uint128",
				},
				{
					name: "calculation-height",
					type: "uint128",
				},
			],
			outputs: "bool",
		},
		{
			name: "is-in-prepare-phase",
			access: "read-only",
			args: [
				{
					name: "current-cycle",
					type: "uint128",
				},
			],
			outputs: "bool",
		},
		{
			name: "min-ustx-for-sats-amount",
			access: "read-only",
			args: [
				{
					name: "sats-amount",
					type: "uint128",
				},
				{
					name: "stx-value-ratio",
					type: "uint128",
				},
				{
					name: "min-ustx-ratio",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "parse-block-header",
			access: "read-only",
			args: [
				{
					name: "headerbuff",
					type: {
						buff: {
							length: 80,
						},
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "merkle-root",
								type: {
									buff: {
										length: 32,
									},
								},
							},
							{
								name: "nbits",
								type: "uint128",
							},
							{
								name: "nonce",
								type: "uint128",
							},
							{
								name: "parent",
								type: {
									buff: {
										length: 32,
									},
								},
							},
							{
								name: "timestamp",
								type: "uint128",
							},
							{
								name: "version",
								type: "uint128",
							},
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "push-c-script-num",
			access: "read-only",
			args: [
				{
					name: "n",
					type: "uint128",
				},
			],
			outputs: {
				response: {
					ok: {
						buff: {
							length: 1027,
						},
					},
					error: "uint128",
				},
			},
		},
		{
			name: "push-script-bytes",
			access: "read-only",
			args: [
				{
					name: "bytes",
					type: {
						buff: {
							length: 1024,
						},
					},
				},
			],
			outputs: {
				buff: {
					length: 1027,
				},
			},
		},
		{
			name: "read-hashslice",
			access: "read-only",
			args: [
				{
					name: "old-ctx",
					type: {
						tuple: [
							{
								name: "index",
								type: "uint128",
							},
							{
								name: "txbuff",
								type: {
									buff: {
										length: 4096,
									},
								},
							},
						],
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "ctx",
								type: {
									tuple: [
										{
											name: "index",
											type: "uint128",
										},
										{
											name: "txbuff",
											type: {
												buff: {
													length: 4096,
												},
											},
										},
									],
								},
							},
							{
								name: "hashslice",
								type: {
									buff: {
										length: 32,
									},
								},
							},
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "read-uint32",
			access: "read-only",
			args: [
				{
					name: "ctx",
					type: {
						tuple: [
							{
								name: "index",
								type: "uint128",
							},
							{
								name: "txbuff",
								type: {
									buff: {
										length: 4096,
									},
								},
							},
						],
					},
				},
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{
								name: "ctx",
								type: {
									tuple: [
										{
											name: "index",
											type: "uint128",
										},
										{
											name: "txbuff",
											type: {
												buff: {
													length: 4096,
												},
											},
										},
									],
								},
							},
							{
								name: "uint32",
								type: "uint128",
							},
						],
					},
					error: "uint128",
				},
			},
		},
		{
			name: "reverse-buff32",
			access: "read-only",
			args: [
				{
					name: "input",
					type: {
						buff: {
							length: 32,
						},
					},
				},
			],
			outputs: {
				buff: {
					length: 32,
				},
			},
		},
		{
			name: "reward-cycle-to-burn-height",
			access: "read-only",
			args: [
				{
					name: "cycle",
					type: "uint128",
				},
			],
			outputs: "uint128",
		},
		{
			name: "serialize-c-script-num",
			access: "read-only",
			args: [
				{
					name: "n",
					type: "uint128",
				},
			],
			outputs: {
				response: {
					ok: {
						buff: {
							length: 5,
						},
					},
					error: "uint128",
				},
			},
		},
		{
			name: "signer-set-contains-for-cycle",
			access: "read-only",
			args: [
				{
					name: "signer",
					type: "principal",
				},
				{
					name: "cycle",
					type: "uint128",
				},
			],
			outputs: "bool",
		},
		{
			name: "uint-to-buff-le",
			access: "read-only",
			args: [
				{
					name: "n",
					type: "uint128",
				},
			],
			outputs: {
				buff: {
					length: 2,
				},
			},
		},
		{
			name: "verify-block-header",
			access: "read-only",
			args: [
				{
					name: "headerbuff",
					type: {
						buff: {
							length: 80,
						},
					},
				},
				{
					name: "expected-block-height",
					type: "uint128",
				},
			],
			outputs: "bool",
		},
		{
			name: "verify-signer-key-grant",
			access: "read-only",
			args: [
				{
					name: "signer-manager",
					type: "principal",
				},
				{
					name: "signer-key",
					type: {
						buff: {
							length: 33,
						},
					},
				},
			],
			outputs: {
				response: {
					ok: "bool",
					error: "uint128",
				},
			},
		},
	],
	maps: [
		{
			name: "protocol-bond-allowances",
			key: {
				tuple: [
					{
						name: "bond-index",
						type: "uint128",
					},
					{
						name: "staker",
						type: "principal",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "protocol-bond-l1-early-exit-announced",
			key: {
				tuple: [
					{
						name: "bond-index",
						type: "uint128",
					},
					{
						name: "staker",
						type: "principal",
					},
				],
			},
			value: "bool",
		},
		{
			name: "protocol-bond-memberships",
			key: "principal",
			value: {
				tuple: [
					{
						name: "amount-sats",
						type: "uint128",
					},
					{
						name: "amount-ustx",
						type: "uint128",
					},
					{
						name: "bond-index",
						type: "uint128",
					},
					{
						name: "is-l1-lock",
						type: "bool",
					},
					{
						name: "signer",
						type: "principal",
					},
				],
			},
		},
		{
			name: "protocol-bonds",
			key: "uint128",
			value: {
				tuple: [
					{
						name: "early-unlock-bytes",
						type: {
							buff: {
								length: 683,
							},
						},
					},
					{
						name: "min-ustx-ratio",
						type: "uint128",
					},
					{
						name: "stx-value-ratio",
						type: "uint128",
					},
					{
						name: "target-rate",
						type: "uint128",
					},
				],
			},
		},
		{
			name: "protocol-bonds-total-staked",
			key: "uint128",
			value: "uint128",
		},
		{
			name: "rewards-per-token-for-cycle",
			key: {
				tuple: [
					{
						name: "bond-index",
						type: {
							optional: "uint128",
						},
					},
					{
						name: "reward-cycle",
						type: "uint128",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "signer-delegated-per-cycle",
			key: {
				tuple: [
					{
						name: "cycle",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "signer-key-grants",
			key: {
				tuple: [
					{
						name: "signer-key",
						type: {
							buff: {
								length: 33,
							},
						},
					},
					{
						name: "signer-manager",
						type: "principal",
					},
				],
			},
			value: "bool",
		},
		{
			name: "signer-pending-staked-ustx-per-cycle",
			key: {
				tuple: [
					{
						name: "cycle",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "signer-rewards-per-token-for-cycle",
			key: {
				tuple: [
					{
						name: "bond-index",
						type: {
							optional: "uint128",
						},
					},
					{
						name: "reward-cycle",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "signer-rewards-per-token-settled-for-cycle",
			key: {
				tuple: [
					{
						name: "bond-index",
						type: {
							optional: "uint128",
						},
					},
					{
						name: "reward-cycle",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "signer-set-ll-first-for-cycle",
			key: "uint128",
			value: "principal",
		},
		{
			name: "signer-set-ll-for-cycle",
			key: {
				tuple: [
					{
						name: "cycle",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
				],
			},
			value: {
				tuple: [
					{
						name: "next",
						type: {
							optional: "principal",
						},
					},
					{
						name: "prev",
						type: {
							optional: "principal",
						},
					},
				],
			},
		},
		{
			name: "signer-set-ll-last-for-cycle",
			key: "uint128",
			value: "principal",
		},
		{
			name: "signer-shares-staked-for-cycle",
			key: {
				tuple: [
					{
						name: "bond-index",
						type: {
							optional: "uint128",
						},
					},
					{
						name: "reward-cycle",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "signer-unclaimed-rewards-for-cycle",
			key: {
				tuple: [
					{
						name: "bond-index",
						type: {
							optional: "uint128",
						},
					},
					{
						name: "reward-cycle",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "signers",
			key: "principal",
			value: {
				buff: {
					length: 33,
				},
			},
		},
		{
			name: "staker-info",
			key: "principal",
			value: {
				tuple: [
					{
						name: "amount-ustx",
						type: "uint128",
					},
					{
						name: "first-reward-cycle",
						type: "uint128",
					},
					{
						name: "num-cycles",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
				],
			},
		},
		{
			name: "staker-rewards-per-token-settled-for-cycle",
			key: {
				tuple: [
					{
						name: "bond-index",
						type: {
							optional: "uint128",
						},
					},
					{
						name: "reward-cycle",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
					{
						name: "staker",
						type: "principal",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "staker-shares-staked-for-cycle",
			key: {
				tuple: [
					{
						name: "bond-index",
						type: {
							optional: "uint128",
						},
					},
					{
						name: "reward-cycle",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
					{
						name: "staker",
						type: "principal",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "staker-signer-cycle-memberships",
			key: {
				tuple: [
					{
						name: "cycle",
						type: "uint128",
					},
					{
						name: "staker",
						type: "principal",
					},
				],
			},
			value: {
				tuple: [
					{
						name: "amount-ustx",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
				],
			},
		},
		{
			name: "staker-unclaimed-rewards-for-cycle",
			key: {
				tuple: [
					{
						name: "bond-index",
						type: {
							optional: "uint128",
						},
					},
					{
						name: "reward-cycle",
						type: "uint128",
					},
					{
						name: "signer",
						type: "principal",
					},
					{
						name: "staker",
						type: "principal",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "total-shares-staked-for-cycle",
			key: {
				tuple: [
					{
						name: "bond-index",
						type: {
							optional: "uint128",
						},
					},
					{
						name: "reward-cycle",
						type: "uint128",
					},
				],
			},
			value: "uint128",
		},
		{
			name: "used-signer-key-grants",
			key: {
				tuple: [
					{
						name: "auth-id",
						type: "uint128",
					},
					{
						name: "signer-key",
						type: {
							buff: {
								length: 33,
							},
						},
					},
					{
						name: "signer-manager",
						type: "principal",
					},
				],
			},
			value: "bool",
		},
		{
			name: "ustx-delegated-per-cycle",
			key: "uint128",
			value: "uint128",
		},
	],
	variables: [
		{
			name: "BOND_GAP_CYCLES",
			type: "uint128",
			access: "constant",
		},
		{
			name: "BOND_LENGTH_CYCLES",
			type: "uint128",
			access: "constant",
		},
		{
			name: "ERR_ACTIVE_BOND_NOT_INCLUDED",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_ALREADY_REGISTERED",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_ALREADY_STAKED",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_BOND_ALREADY_SETUP",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_BOND_ALREADY_STARTED",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_BOND_NOT_ACTIVE",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_BOND_NOT_FOUND",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_CANNOT_ANNOUNCE_L1_EARLY_UNLOCK",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_CANNOT_SETUP_BOND_TOO_LATE",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_CANNOT_SETUP_BOND_TOO_SOON",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_CANNOT_UNSTAKE_SBTC",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_DISTRIBUTION_ALREADY_COMPUTED",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_DUPLICATE_LOCKUP_OUTPOINT",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INSUFFICIENT_RESERVE_BALANCE",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INSUFFICIENT_STX",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_BOND_PERIOD_ORDERING",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_BTC_HEADER",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_LOCKUP_AMOUNT",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_LOCKUP_SCRIPT",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_MERKLE_PROOF",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_NUM_CYCLES",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_OLD_SIGNER_MANAGER",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_SIGNATURE_PUBKEY",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_SIGNATURE_RECOVER",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_START_BURN_HEIGHT",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_UNLOCK_HEIGHT",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_INVALID_UNSTAKE_SBTC_AMOUNT",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_L1_EARLY_EXIT_ALREADY_ANNOUNCED",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_NOT_ALLOWLISTED",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_NOT_BOND_PARTICIPANT",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_NOT_STAKING",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_NO_CLAIMABLE_REWARDS",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_READ_TX_OUT_OF_BOUNDS",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_REENTRANT_CALL",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_REWARDS_PAUSED",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_ROLLOVER_TOO_EARLY",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_SIGNER_KEY_GRANT_NOT_FOUND",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_SIGNER_KEY_GRANT_USED",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_SIGNER_NOT_FOUND",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_STAKER_ALREADY_ADDED",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_STAKE_IN_PREPARE_PHASE",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_TOO_MUCH_SATS",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_UNAUTHORIZED",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_UNAUTHORIZED_SIGNER_REGISTRATION",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_UNSTAKE_IN_PREPARE_PHASE",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "ERR_UPDATE_BOND_SAME_SIGNER",
			type: {
				response: {
					ok: "none",
					error: "uint128",
				},
			},
			access: "constant",
		},
		{
			name: "MAX_NUM_CYCLES",
			type: "uint128",
			access: "constant",
		},
		{
			name: "POX_5_SIGNER_DOMAIN",
			type: {
				tuple: [
					{
						name: "chain-id",
						type: "uint128",
					},
					{
						name: "name",
						type: {
							"string-ascii": {
								length: 12,
							},
						},
					},
					{
						name: "version",
						type: {
							"string-ascii": {
								length: 5,
							},
						},
					},
				],
			},
			access: "constant",
		},
		{
			name: "PRECISION",
			type: "uint128",
			access: "constant",
		},
		{
			name: "RESERVE_RATIO",
			type: "uint128",
			access: "constant",
		},
		{
			name: "SIGNER_SET_MIN_USTX",
			type: "uint128",
			access: "constant",
		},
		{
			name: "SIP018_MSG_PREFIX",
			type: {
				buff: {
					length: 6,
				},
			},
			access: "constant",
		},
		{
			name: "STACKS_ADDR_VERSION_MAINNET",
			type: {
				buff: {
					length: 1,
				},
			},
			access: "constant",
		},
		{
			name: "STACKS_ADDR_VERSION_TESTNET",
			type: {
				buff: {
					length: 1,
				},
			},
			access: "constant",
		},
		{
			name: "bond-admin",
			type: "principal",
			access: "variable",
		},
		{
			name: "configured",
			type: "bool",
			access: "variable",
		},
		{
			name: "first-bond-period-cycle",
			type: "uint128",
			access: "variable",
		},
		{
			name: "first-burnchain-block-height",
			type: "uint128",
			access: "variable",
		},
		{
			name: "first-pox-5-reward-cycle",
			type: "uint128",
			access: "variable",
		},
		{
			name: "last-accounted-rewards-only",
			type: "uint128",
			access: "variable",
		},
		{
			name: "last-reward-compute-height",
			type: "uint128",
			access: "variable",
		},
		{
			name: "pause-admin",
			type: "principal",
			access: "variable",
		},
		{
			name: "pox-prepare-cycle-length",
			type: "uint128",
			access: "variable",
		},
		{
			name: "pox-reward-cycle-length",
			type: "uint128",
			access: "variable",
		},
		{
			name: "reserve-balance",
			type: "uint128",
			access: "variable",
		},
		{
			name: "rewards-paused",
			type: "bool",
			access: "variable",
		},
		{
			name: "signer-manager-call-active",
			type: "bool",
			access: "variable",
		},
		{
			name: "total-sbtc-staked",
			type: "uint128",
			access: "variable",
		},
	],
} as const satisfies AbiContract;
