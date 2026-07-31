import type { ConsumerSink } from "./types.ts";

/**
 * The sink conformance kit: executable probes for the {@link ConsumerSink}
 * contract invariants — the ones that are SILENT when violated in
 * production (torn batches, silent gaps, under-deleted forks) and only
 * surface weeks later as missing or duplicated rows.
 *
 * Run every sink you author through it, in CI, against the real store:
 *
 * ```ts
 * import { test } from "bun:test";
 * import { attachSinkConformance } from "@secondlayer/sdk/sinks/testing";
 *
 * attachSinkConformance(test, {
 *   makeSink: () => mySink(db, { id: "conformance", tables: ["rows"], height: "height" }),
 *   reset: () => db.deleteFrom(...)...,
 *   insertRow: (tx, height, key) => ..., // MUST be replay-safe (upsert on key)
 *   readRows: () => ...,
 *   readCursor: () => ...,
 * });
 * ```
 *
 * Framework-agnostic: probes throw plain `Error`s, so they run under
 * bun:test, vitest, jest, or a bare loop.
 */
export interface SinkConformanceHarness<Tx = unknown> {
	/** A fresh sink instance bound to the SAME store and the SAME checkpoint
	 *  id each call — "new instance" is how the kit simulates a restart. */
	makeSink(): ConsumerSink<Tx> | Promise<ConsumerSink<Tx>>;
	/** Wipe the store back to empty: projection rows AND this id's
	 *  checkpoint. Called before every probe. */
	reset(): Promise<void> | void;
	/** Insert one projection row through the lent transaction, exactly as a
	 *  real `onBatch` handler would. MUST be replay-safe (upsert / insert-
	 *  on-conflict-do-nothing keyed on `key`) — the same requirement the
	 *  contract's at-least-once delivery puts on real handlers. */
	insertRow(tx: Tx, height: number, key: string): Promise<void> | void;
	/** Every committed projection row, read OUTSIDE any transaction. */
	readRows(): Promise<Array<{ height: number; key: string }>>;
	/** The committed checkpoint cursor as visible to a restarted process, or
	 *  `null` when none was ever committed. */
	readCursor(): Promise<string | null>;
	/** Optional (sinks with a writer lock): hold the lock for this sink's id
	 *  — as a second live consumer would — while `during` runs. Enables the
	 *  lock-contention probe (invariant #13: fail loudly, never interleave). */
	withLockHeld?(during: () => Promise<void>): Promise<void>;
}

/** One executable contract probe; `run` throws on violation. */
export interface ConformanceProbe {
	name: string;
	run(): Promise<void>;
}

function fail(probe: string, detail: string): never {
	throw new Error(`sink conformance — ${probe}: ${detail}`);
}

function sortRows(rows: Array<{ height: number; key: string }>) {
	return [...rows].sort(
		(a, b) => a.height - b.height || a.key.localeCompare(b.key),
	);
}

function expectRows(
	probe: string,
	actual: Array<{ height: number; key: string }>,
	expected: Array<{ height: number; key: string }>,
): void {
	const got = JSON.stringify(sortRows(actual));
	const want = JSON.stringify(sortRows(expected));
	if (got !== want) fail(probe, `rows ${got}, expected ${want}`);
}

function expectCursor(
	probe: string,
	actual: string | null,
	expected: string | null,
): void {
	if (actual !== expected) {
		fail(
			probe,
			`cursor ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
		);
	}
}

async function expectRejects(
	probe: string,
	promise: Promise<unknown>,
	why: string,
): Promise<void> {
	let rejected = false;
	try {
		await promise;
	} catch {
		rejected = true;
	}
	if (!rejected) fail(probe, why);
}

/** Build the probe list for a harness. Prefer {@link attachSinkConformance}
 *  inside a test framework; use this directly for a bare runner. */
export function sinkConformanceProbes<Tx>(
	harness: SinkConformanceHarness<Tx>,
): ConformanceProbe[] {
	// Every probe starts from a wiped store and an initialized fresh sink.
	async function start(): Promise<ConsumerSink<Tx>> {
		await harness.reset();
		const sink = await harness.makeSink();
		await sink.loadCursor();
		return sink;
	}
	const commit = (
		sink: ConsumerSink<Tx>,
		cursor: string,
		rows: Array<[number, string]>,
	) =>
		sink.commitBatch(cursor, async (tx) => {
			for (const [height, key] of rows)
				await harness.insertRow(tx, height, key);
		});

	const probes: ConformanceProbe[] = [
		{
			name: "fresh store: loadCursor initializes and returns null",
			async run() {
				await harness.reset();
				const sink = await harness.makeSink();
				const cursor = await sink.loadCursor();
				expectCursor("fresh loadCursor", cursor, null);
			},
		},
		{
			name: "checkpoint persists: a restarted sink resumes from the committed cursor",
			async run() {
				const sink = await start();
				await commit(sink, "10:0", [[10, "a"]]);
				const restarted = await harness.makeSink();
				const resumed = await restarted.loadCursor();
				expectCursor("restart resume", resumed, "10:0");
			},
		},
		{
			name: "crash between rows and cursor: a throw aborts both (invariants #4/#5)",
			async run() {
				const sink = await start();
				await expectRejects(
					"torn batch",
					sink.commitBatch("10:0", async (tx) => {
						await harness.insertRow(tx, 10, "a");
						throw new Error("kill -9");
					}),
					"commitBatch swallowed the handler throw — it must propagate (invariant #12)",
				);
				expectRows("torn batch", await harness.readRows(), []);
				expectCursor("torn batch", await harness.readCursor(), null);
			},
		},
		{
			name: "replaying the same cursor is safe: cursor works as an idempotency key (#7)",
			async run() {
				const sink = await start();
				await commit(sink, "10:0", [[10, "a"]]);
				// At-least-once redelivery: same cursor, same rows (deterministic
				// replay). Neither duplicate rows nor a corrupted checkpoint.
				await commit(sink, "10:0", [[10, "a"]]);
				expectRows("replay", await harness.readRows(), [
					{ height: 10, key: "a" },
				]);
				expectCursor("replay", await harness.readCursor(), "10:0");
			},
		},
		{
			name: "rollback deletes at-or-above the fork — inclusive >= (#8/#9)",
			async run() {
				const sink = await start();
				await commit(sink, "11:0", [
					[10, "a"],
					[11, "b"],
				]);
				await sink.rollback(11, "10:2147483647");
				// The fork block itself (height 11) is deleted: the new canonical
				// chain re-supplies it.
				expectRows("inclusive >=", await harness.readRows(), [
					{ height: 10, key: "a" },
				]);
				expectCursor(
					"inclusive >=",
					await harness.readCursor(),
					"10:2147483647",
				);
			},
		},
		{
			name: "rollback then re-read: canonical rows land cleanly after the rewind",
			async run() {
				const sink = await start();
				await commit(sink, "12:0", [
					[10, "a"],
					[11, "b"],
					[12, "c"],
				]);
				await sink.rollback(11, "10:2147483647");
				expectRows("rollback", await harness.readRows(), [
					{ height: 10, key: "a" },
				]);
				// The re-read: the new canonical chain replaces the orphaned rows.
				await commit(sink, "12:0", [
					[11, "b2"],
					[12, "c2"],
				]);
				expectRows("re-read", await harness.readRows(), [
					{ height: 10, key: "a" },
					{ height: 11, key: "b2" },
					{ height: 12, key: "c2" },
				]);
				expectCursor("re-read", await harness.readCursor(), "12:0");
			},
		},
		{
			name: "rollback is idempotent: re-application after a crash is a no-op (#10)",
			async run() {
				const sink = await start();
				await commit(sink, "11:0", [
					[10, "a"],
					[11, "b"],
				]);
				await sink.rollback(11, "10:2147483647");
				// The loop dedups reorgs in memory only — a restart re-detects the
				// same fork and re-applies the same rollback.
				await sink.rollback(11, "10:2147483647");
				expectRows("idempotent rollback", await harness.readRows(), [
					{ height: 10, key: "a" },
				]);
				expectCursor(
					"idempotent rollback",
					await harness.readCursor(),
					"10:2147483647",
				);
			},
		},
		{
			name: "rollback scopes deletion by forkPointHeight, never rewindCursor (#11)",
			async run() {
				const sink = await start();
				await commit(sink, "13:0", [
					[9, "a"],
					[10, "b"],
					[11, "c"],
					[12, "d"],
					[13, "e"],
				]);
				// A multi-fork page: every call carries the SAME rewindCursor (the
				// lowest fork point) with its OWN forkPointHeight. This call's pair
				// is deliberately mismatched — fork at 12, rewind below 10. A sink
				// deriving the undo range from the cursor deletes 10-11 here.
				await sink.rollback(12, "9:2147483647");
				expectRows("scope by height", await harness.readRows(), [
					{ height: 9, key: "a" },
					{ height: 10, key: "b" },
					{ height: 11, key: "c" },
				]);
				await sink.rollback(10, "9:2147483647");
				expectRows("scope by height (second fork)", await harness.readRows(), [
					{ height: 9, key: "a" },
				]);
				expectCursor(
					"scope by height",
					await harness.readCursor(),
					"9:2147483647",
				);
			},
		},
	];

	if (harness.withLockHeld) {
		const withLockHeld = harness.withLockHeld.bind(harness);
		probes.push({
			name: "lock contention: a second writer fails loudly, never interleaves (#13)",
			async run() {
				const sink = await start();
				await withLockHeld(async () => {
					await expectRejects(
						"lock contention",
						sink.commitBatch("10:0", async (tx) => {
							await harness.insertRow(tx, 10, "a");
						}),
						"commitBatch succeeded while another writer held the lock — two replicas would interleave commits",
					);
				});
				expectRows("lock contention", await harness.readRows(), []);
				expectCursor("lock contention", await harness.readCursor(), null);
			},
		});
	}

	return probes;
}

/**
 * Register every conformance probe with a test framework: pass your
 * framework's `test` function (bun:test, vitest, jest — anything with a
 * `(name, fn)` signature). One probe becomes one test case.
 */
export function attachSinkConformance<Tx>(
	test: (name: string, fn: () => Promise<void>) => void,
	harness: SinkConformanceHarness<Tx>,
): void {
	for (const probe of sinkConformanceProbes(harness)) {
		test(probe.name, () => probe.run());
	}
}
