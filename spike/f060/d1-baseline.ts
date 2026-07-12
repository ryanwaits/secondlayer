// f060 SPIKE — D1: baseline benchmark of the CURRENT in-process handler path.
//
// Run:  bun run spike/f060/d1-baseline.ts
//
// What this measures — and what it does NOT measure:
//
//   REAL (unmodified product code, imported from packages/subgraphs/src):
//     - `generateSubgraphSQL` (schema/generator.ts) builds the scratch tables
//     - `SubgraphContext` (runtime/context.ts) — same class production uses
//     - `runHandlers` (runtime/runner.ts) — same dispatch/sort/checkpoint loop
//     - two of the four handlers are REAL product examples
//       (examples/sales-index/subgraph.ts, packages/subgraphs/examples/
//       contract-deployments.ts), imported not copied
//     - the DB is a real Postgres (docker-postgres-1, 127.0.0.1:5440), and
//       every block runs inside a real `db().transaction()` — same shape as
//       block-processor.ts's managed-subgraph path (block-processor.ts:417-508)
//
//   SYNTHETIC (this file, per the plan's explicit fallback — see plan D1):
//     - block/tx/event *input* (there is no live chain data in the local dev
//       DB — verified: `SELECT count(*) FROM blocks/transactions/events` all
//       return 0 — so MatchedTx batches are hand-built fixtures, not pulled
//       through `resolveBlockSource`/`matchSources`)
//     - the surrounding block-processor plumbing (route resolution, BYO
//       two-phase commit, progress/outbox writes, retry) is NOT exercised
//
// This is a COMPONENT-LEVEL measurement (real ctx + real DB + real handler
// dispatch, synthetic chain input) — not a full end-to-end block replay.
// Labelled as such throughout, per the plan's permitted fallback.
import { performance } from "node:perf_hooks";
import type { Transaction } from "kysely";
import { sql } from "kysely";
import type { Database } from "../../packages/shared/src/db/types.ts";
import {
	type BlockMeta,
	SubgraphContext,
} from "../../packages/subgraphs/src/runtime/context.ts";
import { runHandlers } from "../../packages/subgraphs/src/runtime/runner.ts";
import { generateSubgraphSQL } from "../../packages/subgraphs/src/schema/generator.ts";
import type { SubgraphDefinition } from "../../packages/subgraphs/src/types.ts";
import { assertReachable, db, dropSchema } from "./lib/db.ts";
import {
	bareMatch,
	blockMeta,
	clarityPrincipalHex,
	clarityUintHex,
	contractCallMatch,
	contractDeployMatch,
	principalFor,
	txMeta,
} from "./lib/fixtures.ts";
import { wrapWithOpCounter } from "./lib/op-counter.ts";
import {
	contractDeployments,
	readHeavyAccumulator,
	salesIndex,
	writeOnlyCounters,
} from "./lib/subgraphs.ts";

const WARMUP_BLOCKS = 5;
const MEASURED_BLOCKS = 30;
const EVENTS_PER_BLOCK = 20;

interface Scenario {
	label: string;
	schemaName: string;
	def: SubgraphDefinition;
	buildBatch: (blockHeight: number) => ReturnType<typeof contractCallMatch>[];
}

const SCENARIOS: Scenario[] = [
	{
		label: "sales-index (real handler, examples/sales-index/subgraph.ts)",
		schemaName: "spike_f060_sales",
		def: salesIndex,
		buildBatch: (blockHeight) =>
			Array.from({ length: EVENTS_PER_BLOCK }, (_, i) =>
				contractCallMatch({
					blockHeight,
					txIndex: i,
					sourceName: "sale",
					contractId: "SPNWZ5V2TPWGQGVDR6T7B6RQ4XMGZ4PXTEE0VQ0S.marketplace-v4",
					functionName: "purchase-asset",
					sender: principalFor(blockHeight + i),
					functionArgs: [
						clarityPrincipalHex(principalFor(blockHeight + i + 1)),
						clarityUintHex(blockHeight * 1000 + i),
					],
				}),
			),
	},
	{
		label:
			"contract-deployments (real handler, packages/subgraphs/examples/contract-deployments.ts)",
		schemaName: "spike_f060_deploys",
		def: contractDeployments,
		buildBatch: (blockHeight) =>
			Array.from({ length: EVENTS_PER_BLOCK }, (_, i) =>
				contractDeployMatch({
					blockHeight,
					txIndex: i,
					sourceName: "deploy",
					contractId: `${principalFor(blockHeight + i)}.contract-${blockHeight}-${i}`,
					deployer: principalFor(blockHeight + i),
				}),
			),
	},
	{
		label: "synthetic read-heavy accumulator (2 findOne + 2 increment/event)",
		schemaName: "spike_f060_readheavy",
		def: readHeavyAccumulator,
		buildBatch: (blockHeight) =>
			Array.from({ length: EVENTS_PER_BLOCK }, (_, i) =>
				bareMatch({
					blockHeight,
					txIndex: i,
					sourceName: "tick",
					sender: principalFor(blockHeight + i),
				}),
			),
	},
	{
		label: "synthetic write-only counters (0 reads, 1 increment/event)",
		schemaName: "spike_f060_writeonly",
		def: writeOnlyCounters,
		buildBatch: (blockHeight) =>
			Array.from({ length: EVENTS_PER_BLOCK }, (_, i) =>
				bareMatch({
					blockHeight,
					txIndex: i,
					sourceName: "tick",
					sender: principalFor(blockHeight + i),
				}),
			),
	},
];

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	// biome-ignore lint/style/noNonNullAssertion: s is non-empty at every call site
	return s[Math.floor(s.length / 2)]!;
}
function p99(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const idx = Math.min(s.length - 1, Math.ceil(s.length * 0.99) - 1);
	// biome-ignore lint/style/noNonNullAssertion: idx bounds-checked above
	return s[idx]!;
}

interface ScenarioResult {
	label: string;
	handlerMsMedian: number;
	handlerMsP99: number;
	flushMsMedian: number;
	flushMsP99: number;
	totalMsMedian: number;
	totalMsP99: number;
	reads: number;
	writes: number;
	events: number;
	errors: number;
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
	const database = db();
	await database.executeQuery(
		sql
			.raw(`DROP SCHEMA IF EXISTS "${scenario.schemaName}" CASCADE`)
			.compile(database),
	);
	const { statements } = generateSubgraphSQL(scenario.def, scenario.schemaName);
	for (const stmt of statements) {
		await sql.raw(stmt).execute(database);
	}

	const handlerMs: number[] = [];
	const flushMs: number[] = [];
	const totalMs: number[] = [];
	let reads = 0;
	let writes = 0;
	let events = 0;
	let errors = 0;

	const totalBlocks = WARMUP_BLOCKS + MEASURED_BLOCKS;
	for (let b = 0; b < totalBlocks; b++) {
		const blockHeight = 900_000 + b;
		const meta: BlockMeta = blockMeta(blockHeight);
		const batch = scenario.buildBatch(blockHeight);
		const measured = b >= WARMUP_BLOCKS;

		const blockStart = performance.now();
		await database.transaction().execute(async (tx: Transaction<Database>) => {
			const ctx = new SubgraphContext(
				tx,
				scenario.schemaName,
				scenario.def.schema,
				meta,
				txMeta("", ""),
				false, // byo
				false, // journal — off, matching reindex/backfill heights (block-processor.ts journalEnabled)
			);
			const { proxy, counts } = wrapWithOpCounter(ctx);

			const handlerStart = performance.now();
			const result = await runHandlers(scenario.def, batch, proxy);
			const hMs = performance.now() - handlerStart;

			let fMs = 0;
			if (ctx.pendingOps > 0) {
				const flushStart = performance.now();
				await ctx.flush();
				fMs = performance.now() - flushStart;
			}

			if (measured) {
				handlerMs.push(hMs);
				flushMs.push(fMs);
				reads += counts.reads;
				writes += counts.writes;
				events += result.processed;
				errors += result.errors;
			}
		});
		const tMs = performance.now() - blockStart;
		if (measured) totalMs.push(tMs);
	}

	return {
		label: scenario.label,
		handlerMsMedian: median(handlerMs),
		handlerMsP99: p99(handlerMs),
		flushMsMedian: median(flushMs),
		flushMsP99: p99(flushMs),
		totalMsMedian: median(totalMs),
		totalMsP99: p99(totalMs),
		reads,
		writes,
		events,
		errors,
	};
}

async function main() {
	console.log("f060 D1 — baseline in-process handler benchmark");
	console.log(
		"(component-level: real ctx + real Postgres tx + real handler dispatch, synthetic chain input)\n",
	);
	await assertReachable();

	const results: ScenarioResult[] = [];
	for (const scenario of SCENARIOS) {
		process.stdout.write(`running: ${scenario.label} ... `);
		const result = await runScenario(scenario);
		results.push(result);
		console.log("done");
	}

	console.log(
		`\n${WARMUP_BLOCKS} warmup + ${MEASURED_BLOCKS} measured blocks/scenario, ${EVENTS_PER_BLOCK} events/block\n`,
	);
	console.log(
		"scenario".padEnd(70),
		"handler(med/p99 ms)".padEnd(22),
		"flush(med/p99 ms)".padEnd(20),
		"total(med/p99 ms)".padEnd(20),
		"reads:writes/event",
		"errors",
	);
	for (const r of results) {
		const perEvent = r.events > 0 ? r.reads / r.events : 0;
		const writesPerEvent = r.events > 0 ? r.writes / r.events : 0;
		console.log(
			r.label.padEnd(70),
			`${r.handlerMsMedian.toFixed(2)}/${r.handlerMsP99.toFixed(2)}`.padEnd(22),
			`${r.flushMsMedian.toFixed(2)}/${r.flushMsP99.toFixed(2)}`.padEnd(20),
			`${r.totalMsMedian.toFixed(2)}/${r.totalMsP99.toFixed(2)}`.padEnd(20),
			`${perEvent.toFixed(2)}:${writesPerEvent.toFixed(2)}`,
			String(r.errors),
		);
	}

	console.log("\nraw JSON:");
	console.log(JSON.stringify(results, null, 2));

	for (const scenario of SCENARIOS) {
		await dropSchema(scenario.schemaName);
	}
	process.exit(0);
}

void main();
