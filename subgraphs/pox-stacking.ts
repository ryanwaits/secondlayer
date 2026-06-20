// ───────────────────────────────────────────────────────────────────
// Canonical source for the HOSTED PUBLIC `pox-stacking` subgraph.
//
// Recovered into git 2026-06-20; redesigned per
// docs/sprints/pox-stacking-redesign/spec.md. The deployed v1.0.0 was a stub
// (one `calls` table of function_name/caller/result_ok) at the wrong
// start_block, and the core /v1/index/pox/cycles it should replace returns
// zeros. This decodes pox-4 contract-call args, projects delegation state, and
// derives a reward cycle for every action.
//
// pox-4 emits ZERO print events → contract_call source. event.args are decoded
// Clarity values (uint→bigint, principal→string, buff→0x hex, tuple→object,
// none→null), verified against a live delegate-stx call.
//
// v1 tables: events log (`actions`), `delegations` projection, and the
// `cycles` + `cycle_stackers` pair that replaces /v1/index/pox/cycles. The
// `stackers` projection in the spec is deferred — stack-increase needs
// cumulative accumulation, out of scope for v1.
// ───────────────────────────────────────────────────────────────────

import { defineSubgraph } from "@secondlayer/subgraphs";

// Mainnet PoX cycle schedule (packages/indexer/src/decode/decoders/pox-4.ts).
const FIRST_BURNCHAIN_BLOCK = 666_050;
const REWARD_CYCLE_LENGTH = 2_100;

const SUPPORTED = new Set<string>([
	"stack-stx",
	"stack-extend",
	"stack-increase",
	"delegate-stx",
	"revoke-delegate-stx",
	"delegate-stack-stx",
	"delegate-stack-extend",
	"delegate-stack-increase",
	"stack-aggregation-commit",
	"stack-aggregation-commit-indexed",
	"stack-aggregation-increase",
	"set-signer-key-authorization",
]);

export default defineSubgraph({
	name: "pox-stacking",
	version: "2.0.0",
	description: "PoX-4 stacking actions, delegations, and per-cycle aggregates",

	// pox-4 mainnet deploy height — earliest block that can carry a pox-4 call.
	startBlock: 147290,

	sources: {
		pox: {
			type: "contract_call",
			contractId: "SP000000000000000000002Q6VF78.pox-4",
		},
	},

	schema: {
		// One row per pox-4 call — the decoded event log (replaces the stub `calls`).
		actions: {
			columns: {
				function_name: { type: "text", indexed: true },
				caller: { type: "principal", indexed: true },
				stacker: { type: "principal", nullable: true, indexed: true },
				delegate_to: { type: "principal", nullable: true, indexed: true },
				amount_ustx: { type: "uint", nullable: true },
				lock_period: { type: "uint", nullable: true },
				pox_addr: { type: "text", nullable: true, indexed: true },
				start_cycle: { type: "uint", nullable: true },
				end_cycle: { type: "uint", nullable: true },
				reward_cycle: { type: "uint", nullable: true, indexed: true },
				call_cycle: { type: "uint", indexed: true },
				signer_key: { type: "text", nullable: true },
				result_ok: { type: "boolean" },
				burn_block_height: { type: "uint" },
			},
		},

		// Active delegation per delegator (delegate-stx sets, revoke clears).
		delegations: {
			columns: {
				delegator: { type: "principal" },
				delegate_to: { type: "principal", nullable: true },
				amount_ustx: { type: "uint", nullable: true },
				active: { type: "boolean" },
				last_cycle: { type: "uint", nullable: true },
			},
			uniqueKeys: [["delegator"]],
		},

		// Per-cycle aggregate — replaces /v1/index/pox/cycles. Reorg-safe via
		// ctx.increment (journaled commutative accumulator).
		cycles: {
			columns: {
				reward_cycle: { type: "uint", indexed: true },
				total_stacked_ustx: { type: "uint" },
				action_count: { type: "uint" },
			},
			uniqueKeys: [["reward_cycle"]],
		},

		// (cycle, stacker) membership → unique_stackers/unique_delegators per
		// cycle = COUNT over this table at read time.
		cycle_stackers: {
			columns: {
				reward_cycle: { type: "uint", indexed: true },
				stacker: { type: "principal", indexed: true },
				is_delegator: { type: "boolean" },
			},
			uniqueKeys: [["reward_cycle", "stacker"]],
		},
	},

	handlers: {
		pox: (event, ctx) => {
			const fn = event.functionName;
			if (!fn || !SUPPORTED.has(fn)) return;

			const args = event.args ?? [];
			const caller = ctx.tx.sender;
			const burnHt = ctx.block.burnBlockHeight;
			const callCycle = cycleOf(burnHt);
			const resultOk = (event.resultHex ?? "").startsWith("0x07");

			const d = decode(fn, args, caller);

			ctx.insert("actions", {
				function_name: fn,
				caller,
				stacker: d.stacker,
				delegate_to: d.delegateTo,
				amount_ustx: d.amountUstx,
				lock_period: d.lockPeriod,
				pox_addr: d.poxAddr,
				start_cycle: d.startCycle,
				end_cycle: d.endCycle,
				reward_cycle: d.rewardCycle,
				call_cycle: callCycle,
				signer_key: d.signerKey,
				result_ok: resultOk,
				burn_block_height: burnHt,
			});

			if (!resultOk) return;

			// Delegation projection.
			if (fn === "delegate-stx") {
				ctx.upsert(
					"delegations",
					{ delegator: caller },
					{
						delegate_to: d.delegateTo,
						amount_ustx: d.amountUstx,
						active: true,
						last_cycle: callCycle,
					},
				);
			} else if (fn === "revoke-delegate-stx") {
				ctx.upsert(
					"delegations",
					{ delegator: caller },
					{
						delegate_to: null,
						amount_ustx: null,
						active: false,
						last_cycle: callCycle,
					},
				);
			}

			// Per-cycle aggregate. New stacking attributes its amount to the cycle
			// it starts; aggregation commits to their reward-cycle arg; everything
			// else counts an action against the cycle it occurred in.
			if (fn === "stack-stx" || fn === "delegate-stack-stx") {
				const target = d.startCycle ?? callCycle;
				ctx.increment(
					"cycles",
					{ reward_cycle: target },
					{ total_stacked_ustx: d.amountUstx ?? 0n, action_count: 1 },
				);
				if (d.stacker) {
					ctx.upsert(
						"cycle_stackers",
						{ reward_cycle: target, stacker: d.stacker },
						{ is_delegator: false },
					);
				}
			} else if (
				fn === "stack-aggregation-commit" ||
				fn === "stack-aggregation-commit-indexed" ||
				fn === "stack-aggregation-increase"
			) {
				const target = d.rewardCycle ?? callCycle;
				ctx.increment("cycles", { reward_cycle: target }, { action_count: 1 });
			} else if (fn === "delegate-stx") {
				ctx.increment(
					"cycles",
					{ reward_cycle: callCycle },
					{ action_count: 1 },
				);
				ctx.upsert(
					"cycle_stackers",
					{ reward_cycle: callCycle, stacker: caller },
					{ is_delegator: true },
				);
			} else {
				ctx.increment(
					"cycles",
					{ reward_cycle: callCycle },
					{ action_count: 1 },
				);
			}
		},
	},
});

// ── Per-function arg decode (ports packages/indexer/src/decode/decoders/pox-4.ts) ──

type Decoded = {
	stacker: string | null;
	delegateTo: string | null;
	amountUstx: bigint | null;
	lockPeriod: number | null;
	poxAddr: string | null;
	startCycle: number | null;
	endCycle: number | null;
	rewardCycle: number | null;
	signerKey: string | null;
};

function decode(fn: string, args: unknown[], caller: string): Decoded {
	const base: Decoded = {
		stacker: null,
		delegateTo: null,
		amountUstx: null,
		lockPeriod: null,
		poxAddr: null,
		startCycle: null,
		endCycle: null,
		rewardCycle: null,
		signerKey: null,
	};
	switch (fn) {
		case "stack-stx": {
			const [amount, poxAddr, startBurnHt, lockPeriod, , signerKey] = args;
			const lock = asNum(lockPeriod);
			const start = startCycleOf(startBurnHt);
			return {
				...base,
				stacker: caller,
				amountUstx: asBig(amount),
				lockPeriod: lock,
				poxAddr: poxAddrHex(poxAddr),
				startCycle: start,
				endCycle: start !== null && lock !== null ? start + lock - 1 : null,
				signerKey: asHex(signerKey),
			};
		}
		case "stack-extend": {
			const [extendCount, poxAddr, , signerKey] = args;
			return {
				...base,
				stacker: caller,
				lockPeriod: asNum(extendCount),
				poxAddr: poxAddrHex(poxAddr),
				signerKey: asHex(signerKey),
			};
		}
		case "stack-increase": {
			const [increaseBy, , signerKey] = args;
			return {
				...base,
				stacker: caller,
				amountUstx: asBig(increaseBy),
				signerKey: asHex(signerKey),
			};
		}
		case "delegate-stx": {
			const [amount, delegateTo, , poxAddrOpt] = args;
			return {
				...base,
				delegateTo: asStr(delegateTo),
				amountUstx: asBig(amount),
				poxAddr: poxAddrHex(poxAddrOpt),
			};
		}
		case "revoke-delegate-stx":
			return { ...base, stacker: caller };
		case "delegate-stack-stx": {
			const [stacker, amount, poxAddr, startBurnHt, lockPeriod] = args;
			const lock = asNum(lockPeriod);
			const start = startCycleOf(startBurnHt);
			return {
				...base,
				stacker: asStr(stacker),
				amountUstx: asBig(amount),
				lockPeriod: lock,
				poxAddr: poxAddrHex(poxAddr),
				startCycle: start,
				endCycle: start !== null && lock !== null ? start + lock - 1 : null,
			};
		}
		case "delegate-stack-extend": {
			const [stacker, poxAddr, extendCount] = args;
			return {
				...base,
				stacker: asStr(stacker),
				lockPeriod: asNum(extendCount),
				poxAddr: poxAddrHex(poxAddr),
			};
		}
		case "delegate-stack-increase": {
			const [stacker, poxAddr, increaseBy] = args;
			return {
				...base,
				stacker: asStr(stacker),
				amountUstx: asBig(increaseBy),
				poxAddr: poxAddrHex(poxAddr),
			};
		}
		case "stack-aggregation-commit":
		case "stack-aggregation-commit-indexed":
		case "stack-aggregation-increase": {
			const [poxAddr, rewardCycle, , signerKey] = args;
			return {
				...base,
				poxAddr: poxAddrHex(poxAddr),
				rewardCycle: asNum(rewardCycle),
				signerKey: asHex(signerKey),
			};
		}
		case "set-signer-key-authorization": {
			const [poxAddr, , rewardCycle, , signerKey] = args;
			return {
				...base,
				poxAddr: poxAddrHex(poxAddr),
				rewardCycle: asNum(rewardCycle),
				signerKey: asHex(signerKey),
			};
		}
		default:
			return base;
	}
}

// ── Helpers ──

function cycleOf(burnHeight: number): number {
	return Math.floor((burnHeight - FIRST_BURNCHAIN_BLOCK) / REWARD_CYCLE_LENGTH);
}

function startCycleOf(startBurnHt: unknown): number | null {
	const big = asBig(startBurnHt);
	return big === null ? null : cycleOf(Number(big));
}

function asBig(value: unknown): bigint | null {
	if (typeof value === "bigint") return value;
	if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
	if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
	return null;
}

function asNum(value: unknown): number | null {
	const big = asBig(value);
	return big === null ? null : Number(big);
}

function asStr(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function asHex(value: unknown): string | null {
	if (typeof value !== "string") return null;
	return value.startsWith("0x") ? value : `0x${value}`;
}

// pox-addr is a `{version: (buff 1), hashbytes: (buff N)}` tuple (or none).
// Store a stable `<version>:<hashbytes-hex>` string; BTC encoding is read-time.
function poxAddrHex(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const obj = value as Record<string, unknown>;
	const version = asHex(obj.version);
	const hashbytes = asHex(obj.hashbytes);
	if (!version || !hashbytes) return null;
	const v = Number.parseInt(version.slice(2, 4), 16);
	return `${v}:${hashbytes}`;
}
