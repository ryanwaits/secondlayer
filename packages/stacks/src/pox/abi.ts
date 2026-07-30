import type { AbiContract } from "../clarity/abi/contract.ts";

// NOTE: ABI fragments are written out at each use site rather than shared via a
// module-local const. bunup's dts emitter cannot express a reference to a
// non-exported const — it drops the `type` property entirely (and collapses it
// to `{}` if the const is exported), so the SHIPPED types were malformed while
// the source type-checked clean. Verbose here beats broken for consumers.

export const POX_ABI = {
	functions: [
		// Read-only
		{
			name: "get-pox-info",
			access: "read-only",
			args: [],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "reward-cycle-id", type: "uint128" },
							{ name: "min-amount-ustx", type: "uint128" },
							{ name: "prepare-cycle-length", type: "uint128" },
							{ name: "first-burnchain-block-height", type: "uint128" },
							{ name: "reward-cycle-length", type: "uint128" },
							{ name: "total-liquid-supply-ustx", type: "uint128" },
						],
					},
					error: "none",
				},
			},
		},
		{
			name: "get-stacker-info",
			access: "read-only",
			args: [{ name: "stacker", type: "principal" }],
			outputs: {
				optional: {
					tuple: [
						{
							name: "pox-addr",
							type: {
								tuple: [
									{ name: "version", type: { buff: { length: 1 } } },
									{ name: "hashbytes", type: { buff: { length: 32 } } },
								],
							},
						},
						{ name: "lock-period", type: "uint128" },
						{ name: "first-reward-cycle", type: "uint128" },
						{
							name: "reward-set-indexes",
							type: { list: { type: "uint128", length: 12 } },
						},
						{ name: "delegated-to", type: { optional: "principal" } },
					],
				},
			},
		},
		{
			name: "get-delegation-info",
			access: "read-only",
			args: [{ name: "stacker", type: "principal" }],
			outputs: {
				optional: {
					tuple: [
						{ name: "amount-ustx", type: "uint128" },
						{ name: "delegated-to", type: "principal" },
						{ name: "until-burn-ht", type: { optional: "uint128" } },
						{
							name: "pox-addr",
							type: {
								optional: {
									tuple: [
										{ name: "version", type: { buff: { length: 1 } } },
										{ name: "hashbytes", type: { buff: { length: 32 } } },
									],
								},
							},
						},
					],
				},
			},
		},
		{
			name: "can-stack-stx",
			access: "read-only",
			args: [
				{
					name: "pox-addr",
					type: {
						tuple: [
							{ name: "version", type: { buff: { length: 1 } } },
							{ name: "hashbytes", type: { buff: { length: 32 } } },
						],
					},
				},
				{ name: "amount-ustx", type: "uint128" },
				{ name: "first-reward-cycle", type: "uint128" },
				{ name: "num-cycles", type: "uint128" },
			],
			outputs: { response: { ok: "bool", error: "int128" } },
		},

		// Public
		{
			name: "stack-stx",
			access: "public",
			args: [
				{ name: "amount-ustx", type: "uint128" },
				{
					name: "pox-addr",
					type: {
						tuple: [
							{ name: "version", type: { buff: { length: 1 } } },
							{ name: "hashbytes", type: { buff: { length: 32 } } },
						],
					},
				},
				{ name: "start-burn-ht", type: "uint128" },
				{ name: "lock-period", type: "uint128" },
				{
					name: "signer-sig",
					type: { optional: { buff: { length: 65 } } },
				},
				{ name: "signer-key", type: { buff: { length: 33 } } },
				{ name: "max-amount", type: "uint128" },
				{ name: "auth-id", type: "uint128" },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "stacker", type: "principal" },
							{ name: "lock-amount", type: "uint128" },
							{ name: "signer-key", type: { buff: { length: 33 } } },
							{ name: "unlock-burn-height", type: "uint128" },
						],
					},
					error: "int128",
				},
			},
		},
		{
			name: "delegate-stx",
			access: "public",
			args: [
				{ name: "amount-ustx", type: "uint128" },
				{ name: "delegate-to", type: "principal" },
				{ name: "until-burn-ht", type: { optional: "uint128" } },
				{
					name: "pox-addr",
					type: {
						optional: {
							tuple: [
								{ name: "version", type: { buff: { length: 1 } } },
								{ name: "hashbytes", type: { buff: { length: 32 } } },
							],
						},
					},
				},
			],
			outputs: { response: { ok: "bool", error: "int128" } },
		},
		{
			name: "revoke-delegate-stx",
			access: "public",
			args: [],
			outputs: {
				response: {
					ok: {
						optional: {
							tuple: [
								{ name: "amount-ustx", type: "uint128" },
								{ name: "delegated-to", type: "principal" },
								{ name: "until-burn-ht", type: { optional: "uint128" } },
								{
									name: "pox-addr",
									type: {
										optional: {
											tuple: [
												{ name: "version", type: { buff: { length: 1 } } },
												{ name: "hashbytes", type: { buff: { length: 32 } } },
											],
										},
									},
								},
							],
						},
					},
					error: "int128",
				},
			},
		},
		{
			name: "stack-extend",
			access: "public",
			args: [
				{ name: "extend-count", type: "uint128" },
				{
					name: "pox-addr",
					type: {
						tuple: [
							{ name: "version", type: { buff: { length: 1 } } },
							{ name: "hashbytes", type: { buff: { length: 32 } } },
						],
					},
				},
				{
					name: "signer-sig",
					type: { optional: { buff: { length: 65 } } },
				},
				{ name: "signer-key", type: { buff: { length: 33 } } },
				{ name: "max-amount", type: "uint128" },
				{ name: "auth-id", type: "uint128" },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "stacker", type: "principal" },
							{ name: "unlock-burn-height", type: "uint128" },
						],
					},
					error: "int128",
				},
			},
		},
		{
			name: "stack-increase",
			access: "public",
			args: [
				{ name: "increase-by", type: "uint128" },
				{
					name: "signer-sig",
					type: { optional: { buff: { length: 65 } } },
				},
				{ name: "signer-key", type: { buff: { length: 33 } } },
				{ name: "max-amount", type: "uint128" },
				{ name: "auth-id", type: "uint128" },
			],
			outputs: {
				response: {
					ok: {
						tuple: [
							{ name: "stacker", type: "principal" },
							{ name: "total-locked", type: "uint128" },
						],
					},
					error: "int128",
				},
			},
		},
	],
} as const satisfies AbiContract;
