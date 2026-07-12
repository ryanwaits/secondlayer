import { resolve } from "node:path";
// f060 SPIKE — D2: worker-pool PoC. Host-side orchestrator.
//
// Run:  bun run spike/f060/d2-worker/host.ts
//
// Two things this proves, both empirically (not asserted):
//
//   1. ISOLATION — a hostile handler running in a Bun Worker spawned with
//      `env: {}` cannot read `SECONDLAYER_SECRETS_KEY` (env-scrubbed) and
//      cannot import `node:fs`/`node:child_process` (resolver-locked-down at
//      bundle time, bundle.ts). Run once WITHOUT the env scrub as a control —
//      the secret leaks, proving the scrub is load-bearing, not a no-op.
//
//   2. BOUNDARY OVERHEAD — the real per-`ctx`-op round-trip cost (host holds
//      a real open Postgres transaction; the worker's ctx.findOne/findMany
//      message-passes to it and awaits a reply) and the end-to-end per-block
//      delta vs the D1 in-process baseline, for both a read-heavy and a
//      write-only handler profile.
//
// The host's SubgraphContext is the REAL product class (context.ts) — the
// worker never sees a transaction or a DB connection, only ever a table name
// + a where clause (for reads) or an already-decided op (for writes, which
// the host replays via ctx.insert/upsert/increment/... — i.e. the real flush
// path runs unmodified, see runBlockOnHost below).
import { performance } from "node:perf_hooks";
import type { Transaction } from "kysely";
import { sql } from "kysely";
import type { Database } from "../../../packages/shared/src/db/types.ts";
import {
	type BlockMeta,
	SubgraphContext,
} from "../../../packages/subgraphs/src/runtime/context.ts";
import { generateSubgraphSQL } from "../../../packages/subgraphs/src/schema/generator.ts";
import { assertReachable, db } from "../lib/db.ts";
import {
	blockMeta,
	principalFor,
	syntheticTxId,
	txMeta,
} from "../lib/fixtures.ts";
import { readHeavyAccumulator, writeOnlyCounters } from "../lib/subgraphs.ts";
import { bundleHandlerSource } from "./bundle.ts";
import type { BufferedOp, WorkerToHostMessage } from "./protocol.ts";

const FAKE_SECRET =
	"deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

// SAFETY: this repo's .env.local carries a REAL SECONDLAYER_SECRETS_KEY, and
// Bun auto-loads .env.local — so `process.env.SECONDLAYER_SECRETS_KEY` may
// already be the real dev master key by the time this file runs. Never read
// or print it. The isolation demo needs a KNOWN value to assert against, so
// unconditionally force-override it to FAKE_SECRET via a real re-exec — Bun's
// default Worker env inherits the OS environ captured at worker creation, NOT
// live `process.env[x] = ...` mutations made in JS (verified empirically
// while building this PoC — see the design doc's isolation section for the
// two-line proof) — so a plain assignment here would NOT reach the
// "unscrubbed control" worker below; only a real re-exec does.
if (process.env.F060_REEXECED !== "1") {
	const child = Bun.spawnSync({
		cmd: ["bun", "run", import.meta.path, ...process.argv.slice(2)],
		env: {
			...process.env,
			SECONDLAYER_SECRETS_KEY: FAKE_SECRET,
			F060_REEXECED: "1",
		},
		stdio: ["inherit", "inherit", "inherit"],
	});
	process.exit(child.exitCode ?? 1);
}

const WORKER_ENTRY_URL = new URL("./worker-entry.ts", import.meta.url).href;

function median(xs: number[]): number {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	// biome-ignore lint/style/noNonNullAssertion: xs.length > 0 checked above
	return s[Math.floor(s.length / 2)]!;
}
function p99(xs: number[]): number {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const idx = Math.min(s.length - 1, Math.ceil(s.length * 0.99) - 1);
	// biome-ignore lint/style/noNonNullAssertion: idx bounds-checked above
	return s[idx]!;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Isolation demo
// ─────────────────────────────────────────────────────────────────────────
async function runHostileWorker(
	scrubEnv: boolean,
): Promise<Record<string, unknown>> {
	const bundled = await bundleHandlerSource(
		resolve(import.meta.dir, "handler-src/hostile.ts"),
	);
	const worker = new Worker(WORKER_ENTRY_URL, scrubEnv ? { env: {} } : {});
	return await new Promise((resolveReport, reject) => {
		worker.onmessage = (e: MessageEvent) => {
			const msg = e.data as WorkerToHostMessage;
			if (msg.type === "ready") {
				worker.postMessage({ type: "runHostile" });
				return;
			}
			if (msg.type === "hostileReport") {
				worker.terminate();
				resolveReport(msg.report);
				return;
			}
			if (msg.type === "error") {
				worker.terminate();
				reject(new Error(msg.message));
			}
		};
		worker.postMessage({
			type: "init",
			bundledCode: bundled,
			handlerKind: "hostile",
		});
	});
}

/** Never print a secret value verbatim — this repo's real dev key can end up
 *  in `process.env` via Bun's .env.local auto-load, and a hostile worker's
 *  report field is attacker-controlled data on principle even when we know
 *  it's our own fixture. Report only what a security reviewer needs: did it
 *  match our known FAKE_SECRET, or is it genuinely absent. */
function redactSecretField(value: unknown): string {
	if (value === "<absent>") return "<absent>";
	if (value === FAKE_SECRET) return "<matches known fake fixture value>";
	if (typeof value === "string" && value.length > 8) {
		return `<redacted, ${value.length} chars, unexpected value — NOT the fake fixture>`;
	}
	return String(value);
}

function redactReport(
	report: Record<string, unknown>,
): Record<string, unknown> {
	return { ...report, envSecret: redactSecretField(report.envSecret) };
}

async function isolationDemo(): Promise<void> {
	console.log("=== D2 isolation demo ===\n");

	console.log(
		"control: worker WITHOUT env scrub (default env, real secret present)",
	);
	const leaked = await runHostileWorker(false);
	console.log("  ", redactReport(leaked), "\n");

	console.log("target: worker WITH env: {} (production posture)");
	const blocked = await runHostileWorker(true);
	console.log("  ", redactReport(blocked), "\n");

	const scrubWorks = blocked.envSecret === "<absent>";
	const leakWithoutScrub = leaked.envSecret === FAKE_SECRET;
	const resolverBlocksInBothCases =
		blocked.fsBlocked === true &&
		blocked.childProcessBlocked === true &&
		leaked.fsBlocked === true &&
		leaked.childProcessBlocked === true;

	console.log("RESULT");
	console.log(`  env scrub blocks secret read       : ${scrubWorks}`);
	console.log(
		`  unscrubbed control DOES leak (sanity check the scrub is load-bearing) : ${leakWithoutScrub}`,
	);
	console.log(
		`  resolver lockdown blocks node:fs / node:child_process (both workers)  : ${resolverBlocksInBothCases}`,
	);
	console.log();
}

// ─────────────────────────────────────────────────────────────────────────
// 1b. fix-f040 B6 checkpoint/rollback demo — answers the open question
// "does moving the tx host-side and the handler worker-side keep
// fix-f040's per-handler checkpoint/rollback atomicity intact?" empirically,
// not just by assertion. Runs ONE block (5 events, 2 "poisoned") through the
// read-heavy worker and checks that a mid-handler throw contributes ZERO ops
// — not a partial write — same invariant runner.ts:446/497 enforces
// in-process today.
// ─────────────────────────────────────────────────────────────────────────
async function checkpointRollbackDemo(): Promise<void> {
	console.log("=== fix-f040 B6 checkpoint/rollback demo (worker-side) ===\n");
	const bundled = await bundleHandlerSource(
		resolve(import.meta.dir, "handler-src/read-heavy.ts"),
	);
	const worker = new Worker(WORKER_ENTRY_URL, { env: {} });
	await new Promise<void>((resolveReady) => {
		worker.onmessage = (e: MessageEvent) => {
			if ((e.data as WorkerToHostMessage).type === "ready") resolveReady();
		};
		worker.postMessage({
			type: "init",
			bundledCode: bundled,
			handlerKind: "read-heavy",
		});
	});

	// 5 events, 2 poisoned. Each CLEAN event's handler queues 2 increments
	// (sender + recipient); each POISONED event throws after queuing only the
	// first (sender) increment. If rollback works: 3 clean * 2 = 6 ops survive,
	// 0 orphaned. If rollback is broken: 6 + 2 orphaned sender-only ops = 8.
	const events = [
		{ sender: principalFor(0), txId: syntheticTxId(1, 0), poison: false },
		{ sender: principalFor(1), txId: syntheticTxId(1, 1), poison: true },
		{ sender: principalFor(2), txId: syntheticTxId(1, 2), poison: false },
		{ sender: principalFor(3), txId: syntheticTxId(1, 3), poison: true },
		{ sender: principalFor(0), txId: syntheticTxId(1, 4), poison: false },
	];

	const { ops, errors } = await new Promise<{
		ops: BufferedOp[];
		errors: number;
	}>((resolveBlock, reject) => {
		worker.onmessage = (e: MessageEvent) => {
			const msg = e.data as WorkerToHostMessage;
			// No reads are backed by a real DB here (isolated demo, no host tx) —
			// findOne round trips still happen, so answer them with `null` (empty
			// table) to let the handler proceed to the write it's actually testing.
			if (msg.type === "readRequest") {
				worker.postMessage({
					type: "readResponse",
					id: msg.id,
					row: null,
					ms: 0,
				});
				return;
			}
			if (msg.type === "blockDone") {
				resolveBlock({ ops: msg.ops, errors: msg.errors });
				return;
			}
			if (msg.type === "error") reject(new Error(msg.message));
		};
		worker.postMessage({ type: "runBlock", blockHeight: 1, events });
	});
	worker.terminate();

	const expectedOps = 3 * 2; // 3 clean events * 2 increments each
	const noOrphans = ops.length === expectedOps;
	const errorsMatchPoisoned = errors === 2;

	console.log("  events: 5 (3 clean, 2 poisoned)");
	console.log(
		`  ops shipped home: ${ops.length} (expected ${expectedOps} if rollback is clean, ${expectedOps + 2} if a poisoned event's first write leaked)`,
	);
	console.log(`  errors reported: ${errors} (expected 2)`);
	console.log("RESULT");
	console.log(
		`  no orphaned partial writes from poisoned events : ${noOrphans}`,
	);
	console.log(
		`  error count matches poisoned-event count        : ${errorsMatchPoisoned}`,
	);
	console.log();
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Boundary overhead benchmark
// ─────────────────────────────────────────────────────────────────────────
interface BenchScenario {
	label: string;
	handlerKind: "read-heavy" | "write-only";
	handlerSrc: string;
	schemaName: string;
	def: typeof readHeavyAccumulator;
}

const SCENARIOS: BenchScenario[] = [
	{
		label: "read-heavy (2 findOne + 2 increment/event)",
		handlerKind: "read-heavy",
		handlerSrc: resolve(import.meta.dir, "handler-src/read-heavy.ts"),
		schemaName: "spike_f060_d2_readheavy",
		def: readHeavyAccumulator,
	},
	{
		label: "write-only (0 reads, 1 increment/event)",
		handlerKind: "write-only",
		handlerSrc: resolve(import.meta.dir, "handler-src/write-only.ts"),
		schemaName: "spike_f060_d2_writeonly",
		def: writeOnlyCounters,
	},
];

const WARMUP_BLOCKS = 5;
const MEASURED_BLOCKS = 30;
const EVENTS_PER_BLOCK = 20;

async function runBenchScenario(scenario: BenchScenario) {
	const database = db();
	await database.executeQuery(
		sql
			.raw(`DROP SCHEMA IF EXISTS "${scenario.schemaName}" CASCADE`)
			.compile(database),
	);
	const { statements } = generateSubgraphSQL(scenario.def, scenario.schemaName);
	for (const stmt of statements) await sql.raw(stmt).execute(database);

	const bundled = await bundleHandlerSource(scenario.handlerSrc);

	const blockTotalMs: number[] = [];
	const handlerMsAtWorker: number[] = [];
	const flushMsAtHost: number[] = [];
	const allReadRoundTripMs: number[] = [];

	const worker = new Worker(WORKER_ENTRY_URL, { env: {} });
	await new Promise<void>((resolveReady) => {
		worker.onmessage = (e: MessageEvent) => {
			const msg = e.data as WorkerToHostMessage;
			if (msg.type === "ready") resolveReady();
		};
		worker.postMessage({
			type: "init",
			bundledCode: bundled,
			handlerKind: scenario.handlerKind,
		});
	});

	const totalBlocks = WARMUP_BLOCKS + MEASURED_BLOCKS;
	for (let b = 0; b < totalBlocks; b++) {
		const blockHeight = 950_000 + b;
		const measured = b >= WARMUP_BLOCKS;
		const events = Array.from({ length: EVENTS_PER_BLOCK }, (_, i) => ({
			sender: principalFor(blockHeight + i),
			txId: syntheticTxId(blockHeight, i),
		}));

		const blockStart = performance.now();

		// ONE real transaction for the whole block — reads (round-tripped to
		// the worker mid-handler) AND the end-of-block flush, matching
		// block-processor.ts's managed-subgraph contract exactly (a single
		// `targetDb.transaction().execute(async tx => { ctx = new
		// SubgraphContext(tx,...); runHandlers(...); ctx.flush(); })`,
		// block-processor.ts:417-508) — not two separate transactions. The
		// `await` on blockDone happens INSIDE the transaction callback, and the
		// flush happens before the callback returns, so Kysely commits exactly
		// once per block, same as production.
		await database.transaction().execute(async (tx: Transaction<Database>) => {
			const meta: BlockMeta = blockMeta(blockHeight);
			const hostCtx = new SubgraphContext(
				tx,
				scenario.schemaName,
				scenario.def.schema,
				meta,
				txMeta("", ""),
				false,
				false,
			);

			const ops: BufferedOp[] = await new Promise((resolveBlock, reject) => {
				const onMsg = async (e: MessageEvent) => {
					const msg = e.data as WorkerToHostMessage;
					if (msg.type === "readRequest") {
						const t0 = performance.now();
						const row =
							msg.method === "findOne"
								? await hostCtx.findOne(msg.table, msg.where)
								: ((await hostCtx.findMany(msg.table, msg.where))[0] ?? null);
						worker.postMessage({
							type: "readResponse",
							id: msg.id,
							row,
							ms: performance.now() - t0,
						});
						return;
					}
					if (msg.type === "blockDone") {
						worker.removeEventListener("message", onMsg as EventListener);
						if (measured) {
							handlerMsAtWorker.push(msg.handlerMs);
							allReadRoundTripMs.push(...msg.readRoundTripMs);
						}
						resolveBlock(msg.ops);
						return;
					}
					if (msg.type === "error") {
						worker.removeEventListener("message", onMsg as EventListener);
						reject(new Error(msg.message));
					}
				};
				worker.addEventListener("message", onMsg as EventListener);
				worker.postMessage({ type: "runBlock", blockHeight, events });
			});

			// End-of-block: replay the worker's decided ops through the REAL ctx
			// (real insert/upsert/increment → real flush() → real SQL), same tx —
			// "host keeps the tx, worker only decides ops" (design doc §D3).
			for (const op of ops) {
				// biome-ignore lint/suspicious/noExplicitAny: replaying a dynamically-typed op onto the real ctx's method of the same name
				(hostCtx as any)[op.method](op.table, ...op.args);
			}
			if (hostCtx.pendingOps > 0) {
				const flushStart = performance.now();
				await hostCtx.flush();
				if (measured) flushMsAtHost.push(performance.now() - flushStart);
			}
		});

		if (measured) blockTotalMs.push(performance.now() - blockStart);
	}

	worker.postMessage({ type: "shutdown" });
	worker.terminate();
	await sql
		.raw(`DROP SCHEMA IF EXISTS "${scenario.schemaName}" CASCADE`)
		.execute(database);

	return {
		label: scenario.label,
		handlerMsMedian: median(handlerMsAtWorker),
		handlerMsP99: p99(handlerMsAtWorker),
		flushMsMedian: median(flushMsAtHost),
		flushMsP99: p99(flushMsAtHost),
		blockTotalMsMedian: median(blockTotalMs),
		blockTotalMsP99: p99(blockTotalMs),
		readRoundTripMsMedian: median(allReadRoundTripMs),
		readRoundTripMsP99: p99(allReadRoundTripMs),
		readCount: allReadRoundTripMs.length,
	};
}

async function overheadBenchmark(): Promise<void> {
	console.log("=== D2 boundary overhead benchmark ===");
	console.log(
		`(${WARMUP_BLOCKS} warmup + ${MEASURED_BLOCKS} measured blocks/scenario, ${EVENTS_PER_BLOCK} events/block, worker env: {})\n`,
	);
	for (const scenario of SCENARIOS) {
		process.stdout.write(`running: ${scenario.label} ... `);
		const result = await runBenchScenario(scenario);
		console.log("done");
		console.log(
			`  worker handlerMs   med/p99: ${result.handlerMsMedian.toFixed(2)}/${result.handlerMsP99.toFixed(2)} ms`,
		);
		console.log(
			`  host flushMs       med/p99: ${result.flushMsMedian.toFixed(2)}/${result.flushMsP99.toFixed(2)} ms`,
		);
		console.log(
			`  block total (E2E)  med/p99: ${result.blockTotalMsMedian.toFixed(2)}/${result.blockTotalMsP99.toFixed(2)} ms`,
		);
		if (result.readCount > 0) {
			console.log(
				`  per-read round trip med/p99: ${result.readRoundTripMsMedian.toFixed(3)}/${result.readRoundTripMsP99.toFixed(3)} ms  (n=${result.readCount})`,
			);
		} else {
			console.log("  per-read round trip: n/a (no reads in this profile)");
		}
		console.log();
	}
}

async function main() {
	await assertReachable();
	await isolationDemo();
	await checkpointRollbackDemo();
	await overheadBenchmark();
	process.exit(0);
}

void main();
