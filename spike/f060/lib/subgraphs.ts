// f060 SPIKE — the four subgraph definitions the benchmark drives.
//
// Two are REAL, unmodified product examples (imported, not copied) per the
// plan's D1 instruction to use "examples/sales-index/subgraph.ts and
// packages/subgraphs/examples/contract-deployments.ts". Two are synthetic
// worst-case profiles (also explicitly permitted by the plan) chosen to
// bracket the ctx-op ratio that decides whether a worker boundary is viable:
//
//   - salesIndex          — real handler, 0 ctx reads, 1 ctx write (insert)
//   - contractDeployments — real handler, 0 ctx reads, 1 ctx write (upsert)
//   - readHeavyAccumulator — synthetic, 2 ctx reads (findOne) + 2 ctx writes
//     (increment) per event — the classic "balance = f(existing)" pattern
//     context.ts:67 calls out as the read-your-writes load-bearing case.
//   - writeOnlyCounters    — synthetic, 0 ctx reads, 1 ctx write per event —
//     the fully-batchable case.
import { resolve } from "node:path";
import type { SubgraphDefinition } from "../../../packages/subgraphs/src/types.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

const salesIndexMod = await import(
	resolve(REPO_ROOT, "examples/sales-index/subgraph.ts")
);
export const salesIndex = (salesIndexMod.default ??
	salesIndexMod) as SubgraphDefinition;

const contractDeploymentsMod = await import(
	resolve(REPO_ROOT, "packages/subgraphs/examples/contract-deployments.ts")
);
export const contractDeployments = (contractDeploymentsMod.default ??
	contractDeploymentsMod) as SubgraphDefinition;

export const readHeavyAccumulator: SubgraphDefinition = {
	name: "spike-f060-read-heavy",
	sources: {
		tick: {
			type: "contract_call",
			contractId: "SP000000000000000000002Q6VF78.ledger",
			functionName: "transfer",
		},
	},
	schema: {
		read_heavy_balances: {
			columns: {
				address: { type: "principal", indexed: true },
				balance: { type: "uint" },
			},
			uniqueKeys: [["address"]],
		},
	},
	handlers: {
		// Mirrors a token-ledger transfer: look up sender AND recipient balances
		// (read-your-writes matters here — two events in the same block touching
		// the same address must see each other's deltas), then credit both.
		// Deltas are kept positive so the benchmark never trips the uint CHECK
		// constraint (context.ts:791-798) — that ordering bug is a separate,
		// already-fixed concern, not what this spike measures.
		tick: async (event, ctx) => {
			const e = event as { sender: string; tx: { txId: string } };
			const senderKey = e.sender;
			const recipientKey = `spike-${e.tx.txId.slice(2, 10)}`;
			await ctx.findOne("read_heavy_balances", { address: senderKey });
			await ctx.findOne("read_heavy_balances", { address: recipientKey });
			ctx.increment(
				"read_heavy_balances",
				{ address: senderKey },
				{
					balance: 1n,
				},
			);
			ctx.increment(
				"read_heavy_balances",
				{ address: recipientKey },
				{
					balance: 1n,
				},
			);
		},
	},
};

export const writeOnlyCounters: SubgraphDefinition = {
	name: "spike-f060-write-only",
	sources: {
		tick: {
			type: "contract_call",
			contractId: "SP000000000000000000002Q6VF78.ledger",
			functionName: "transfer",
		},
	},
	schema: {
		write_only_counters: {
			columns: {
				key: { type: "text", indexed: true },
				count: { type: "uint" },
			},
			uniqueKeys: [["key"]],
		},
	},
	handlers: {
		tick: (event, ctx) => {
			const e = event as { sender: string };
			ctx.increment("write_only_counters", { key: e.sender }, { count: 1n });
		},
	},
};

export const ALL_SUBGRAPHS: SubgraphDefinition[] = [
	salesIndex,
	contractDeployments,
	readHeavyAccumulator,
	writeOnlyCounters,
];
