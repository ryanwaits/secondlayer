#!/usr/bin/env bun
import { closeDbOrTimeout, getSourceDb, sql } from "@secondlayer/shared/db";
/**
 * Rewrite a big live chain table into a new shape without stopping ingest.
 *
 * A `<table>_next` copy is filled window by window while triggers log every
 * height the live table changes; dirty heights are re-copied until the backlog
 * is small. A deploy migration then swaps the tables (`swapLiveRewrite`)
 * while writers are stopped. Every command is a dry run without `--apply`.
 * Run one command at a time per table. Every command resumes where the last
 * one stopped: kill it and rerun.
 *
 * Usage:
 *   bun run packages/indexer/src/live-rewrite.ts --table vm_events prepare [--apply]
 *   bun run packages/indexer/src/live-rewrite.ts --table vm_events copy [--max-windows N] [--apply]
 *   bun run packages/indexer/src/live-rewrite.ts --table vm_events catchup [--apply]
 *   bun run packages/indexer/src/live-rewrite.ts --table vm_events index [--apply]
 *   bun run packages/indexer/src/live-rewrite.ts --table vm_events verify [--sample 2000] [--apply]
 *   bun run packages/indexer/src/live-rewrite.ts --table vm_events preflight [--apply]
 *   bun run packages/indexer/src/live-rewrite.ts --table vm_events abort [--apply]
 *
 * prepare    bookkeeping tables, <table>_next, dirty-height triggers
 * copy       windowed bulk copy from copied_below to the live tip
 * catchup    copy new heights, then re-copy every dirty height
 * index      build the cloned indexes and foreign keys on <table>_next
 * verify     per-window counts and sampled digests, live vs next
 * preflight  catchup, then print READY or each reason the swap would refuse
 * abort      drop only tool-created objects (never the live table)
 */
import {
	type HeightDigest,
	LIVE_REWRITE_INDEX_LAG_HEIGHTS,
	LIVE_REWRITE_SPECS,
	LIVE_REWRITE_WINDOW_HEIGHTS,
	type LiveRewriteDb,
	type LiveRewriteSpec,
	abortLiveRewrite,
	copyNextWindow,
	copyToTip,
	createBookkeeping,
	diffDigests,
	drainDirtyHeights,
	ensureProgressRow,
	installTriggers,
	isLiveRewriteReady,
	liveCopyTarget,
	nextTableName,
	planClone,
	readLiveRewriteFacts,
} from "@secondlayer/shared/db/live-rewrite";

export const LIVE_REWRITE_COMMANDS = [
	"prepare",
	"copy",
	"catchup",
	"index",
	"verify",
	"preflight",
	"abort",
] as const;
export type LiveRewriteCommand = (typeof LIVE_REWRITE_COMMANDS)[number];

export type LiveRewriteRunOptions = {
	apply: boolean;
	maxWindows?: number;
	sample: number;
	print: (line: string) => void;
};

const DEFAULT_SAMPLE_HEIGHTS = 2_000;
const NEWEST_VERIFIED_HEIGHTS = 1_000;
const DIGEST_CHUNK_HEIGHTS = 100;
const PREPARE_LOCK_TIMEOUT = "5s";
const PREPARE_ATTEMPTS = 5;
const PREPARE_RETRY_MS = 2_000;
const INDEX_MAINTENANCE_WORK_MEM = "8GB";
const INDEX_PARALLEL_WORKERS = 8;
const SAMPLE_ROWS_FULL_SCAN_MAX = 100_000;
const SAMPLE_PERCENT_LARGE = 0.02;

function compile(
	db: LiveRewriteDb,
	statement: { compile: (db: LiveRewriteDb) => { sql: string } },
): string {
	return statement.compile(db).sql;
}

async function nextCount(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	from: number,
	to: number,
): Promise<number> {
	const r = await sql<{ n: number }>`
		SELECT count(*)::int AS n FROM ${sql.table(nextTableName(spec.table))}
		 WHERE block_height >= ${from} AND block_height < ${to}
	`.execute(db);
	return r.rows[0]?.n ?? 0;
}

async function liveCount(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	from: number,
	to: number,
): Promise<number> {
	const r = await sql<{ n: number }>`
		SELECT (${spec.sourceRowsInRange(from, to)})::int AS n
	`.execute(db);
	return r.rows[0]?.n ?? 0;
}

async function readProgress(
	db: LiveRewriteDb,
	table: string,
): Promise<{ copiedBelow: number; minHeight: number | null }> {
	const r = await sql<{ copied_below: number }>`
		SELECT copied_below::int AS copied_below
		  FROM live_rewrite_progress WHERE table_name = ${table}
	`.execute(db);
	const min = await sql<{ min: number | null }>`
		SELECT min(block_height)::int AS min FROM ${sql.table(table)}
	`.execute(db);
	return {
		copiedBelow: r.rows[0]?.copied_below ?? 0,
		minHeight: min.rows[0]?.min ?? null,
	};
}

async function requirePrepared(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
): Promise<void> {
	const facts = await readLiveRewriteFacts(db, spec);
	if (!facts.nextExists || facts.copiedBelow === null) {
		throw new Error(`${spec.table}: run prepare --apply first`);
	}
}

async function prepare(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	opts: LiveRewriteRunOptions,
): Promise<number> {
	opts.print(compile(db, spec.createNext));
	opts.print(`-- dirty-height triggers on ${spec.table}, progress row`);
	if (!opts.apply) return 0;
	await createBookkeeping(db);
	await spec.createNext.execute(db);
	for (let attempt = 1; ; attempt++) {
		try {
			await db.connection().execute(async (conn) => {
				await sql`SET lock_timeout = ${sql.lit(PREPARE_LOCK_TIMEOUT)}`.execute(
					conn,
				);
				try {
					await installTriggers(conn, spec);
				} finally {
					await sql`RESET lock_timeout`.execute(conn);
				}
			});
			break;
		} catch (err) {
			const lockTimeout =
				err instanceof Error && /lock timeout|55P03/i.test(err.message);
			if (!lockTimeout || attempt >= PREPARE_ATTEMPTS) throw err;
			opts.print(`lock timeout installing triggers, retry ${attempt}`);
			await Bun.sleep(PREPARE_RETRY_MS);
		}
	}
	await ensureProgressRow(db, spec.table);
	opts.print(`${spec.table}: prepared`);
	return 0;
}

async function copy(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	opts: LiveRewriteRunOptions,
): Promise<number> {
	await requirePrepared(db, spec);
	const upTo = await liveCopyTarget(db, spec);
	const { copiedBelow } = await readProgress(db, spec.table);
	const remaining = Math.max(0, upTo - copiedBelow);
	const windows = Math.ceil(remaining / LIVE_REWRITE_WINDOW_HEIGHTS);
	opts.print(
		`${spec.table}: copied_below ${copiedBelow}, live tip ${upTo}, ${windows} windows remaining`,
	);
	if (!opts.apply) {
		opts.print(
			compile(
				db,
				spec.copyRange(copiedBelow, copiedBelow + LIVE_REWRITE_WINDOW_HEIGHTS),
			),
		);
		return 0;
	}
	const startedAt = Date.now();
	let rows = 0;
	let done = 0;
	const limit = opts.maxWindows ?? Number.POSITIVE_INFINITY;
	while (done < limit) {
		const window = await copyNextWindow(db, spec, {
			upTo,
			stampCopiedAt: true,
		});
		if (!window) break;
		done++;
		rows += window.rows;
		const elapsed = (Date.now() - startedAt) / 1000;
		const heightsPerSec = (done * LIVE_REWRITE_WINDOW_HEIGHTS) / elapsed;
		const etaMinutes =
			heightsPerSec > 0
				? (Math.max(0, windows - done) * LIVE_REWRITE_WINDOW_HEIGHTS) /
					heightsPerSec /
					60
				: 0;
		opts.print(
			`[${window.from}, ${window.to}) ${window.rows} rows | ${Math.round(rows / Math.max(elapsed, 1))} rows/s | eta ${etaMinutes.toFixed(1)} min`,
		);
	}
	return 0;
}

async function catchup(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	opts: LiveRewriteRunOptions,
): Promise<number> {
	await requirePrepared(db, spec);
	const facts = await readLiveRewriteFacts(db, spec);
	opts.print(
		`${spec.table}: copied_below ${facts.copiedBelow}, live max ${facts.liveMaxHeight}, ${facts.pendingDirtyHeights} dirty heights`,
	);
	if (!opts.apply) return 0;
	const rows = await copyToTip(db, spec, { stampCopiedAt: false });
	const dirty = await drainDirtyHeights(db, spec);
	opts.print(
		`${spec.table}: copied ${rows} tail rows, re-copied ${dirty} dirty heights`,
	);
	return 0;
}

async function buildIndexes(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	opts: LiveRewriteRunOptions,
): Promise<number> {
	await requirePrepared(db, spec);
	const facts = await readLiveRewriteFacts(db, spec);
	if (
		facts.liveMaxHeight !== null &&
		(facts.copiedBelow ?? 0) <=
			facts.liveMaxHeight - LIVE_REWRITE_INDEX_LAG_HEIGHTS
	) {
		throw new Error(
			`${spec.table}: copy is more than ${LIVE_REWRITE_INDEX_LAG_HEIGHTS} heights behind, finish copy first`,
		);
	}
	const plan = await planClone(db, spec);
	for (const index of plan.indexes) opts.print(index.create);
	for (const fk of plan.constraints) {
		opts.print(fk.add);
		opts.print(fk.validate);
	}
	if (!opts.apply) return 0;

	await db.connection().execute(async (conn) => {
		await sql`SET statement_timeout = 0`.execute(conn);
		await sql`SET maintenance_work_mem = ${sql.lit(INDEX_MAINTENANCE_WORK_MEM)}`.execute(
			conn,
		);
		await sql`SET max_parallel_maintenance_workers = ${sql.lit(INDEX_PARALLEL_WORKERS)}`.execute(
			conn,
		);
		try {
			for (const index of plan.indexes) {
				const state = await sql<{ valid: boolean }>`
					SELECT i.indisvalid AS valid FROM pg_index i
					  JOIN pg_class c ON c.oid = i.indexrelid
					 WHERE c.relname = ${index.nextName} AND c.relnamespace = 'public'::regnamespace
				`.execute(conn);
				const existing = state.rows[0];
				if (existing?.valid) continue;
				if (existing) {
					await sql`DROP INDEX ${sql.id(index.nextName)}`.execute(conn);
				}
				opts.print(`building ${index.nextName}`);
				await sql.raw(index.create).execute(conn);
			}
			for (const fk of plan.constraints) {
				const state = await sql<{ validated: boolean }>`
					SELECT convalidated AS validated FROM pg_constraint
					 WHERE conname = ${fk.nextName}
					   AND conrelid = to_regclass(${`public.${nextTableName(spec.table)}`})
				`.execute(conn);
				const existing = state.rows[0];
				if (!existing) await sql.raw(fk.add).execute(conn);
				if (!existing?.validated) await sql.raw(fk.validate).execute(conn);
			}
		} finally {
			await sql`RESET statement_timeout`.execute(conn);
			await sql`RESET maintenance_work_mem`.execute(conn);
			await sql`RESET max_parallel_maintenance_workers`.execute(conn);
		}
	});
	opts.print(`${spec.table}: indexes and constraints built`);
	return 0;
}

async function sampleHeights(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	copiedBelow: number,
	sample: number,
): Promise<number[]> {
	const est = await sql<{ rows: number }>`
		SELECT COALESCE(reltuples, -1)::bigint AS rows
		  FROM pg_class WHERE oid = to_regclass(${`public.${spec.table}`})
	`.execute(db);
	const rowEstimate = Number(est.rows[0]?.rows ?? -1);
	const percent =
		rowEstimate <= SAMPLE_ROWS_FULL_SCAN_MAX ? 100 : SAMPLE_PERCENT_LARGE;
	const picked = await sql<{ block_height: number }>`
		SELECT DISTINCT block_height::int AS block_height
		  FROM ${sql.table(spec.table)} TABLESAMPLE SYSTEM (${percent})
		 WHERE block_height < ${copiedBelow}
	`.execute(db);
	const shuffled = picked.rows
		.map((r) => r.block_height)
		.sort(() => Math.random() - 0.5)
		.slice(0, sample);
	const newest = await sql<{ block_height: number }>`
		SELECT DISTINCT block_height::int AS block_height
		  FROM ${sql.table(spec.table)}
		 WHERE block_height >= ${copiedBelow - NEWEST_VERIFIED_HEIGHTS}
		   AND block_height < ${copiedBelow}
	`.execute(db);
	return [...new Set([...shuffled, ...newest.rows.map((r) => r.block_height)])];
}

async function digestDiff(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	heights: readonly number[],
): Promise<number[]> {
	const differing: number[] = [];
	for (let i = 0; i < heights.length; i += DIGEST_CHUNK_HEIGHTS) {
		const chunk = heights.slice(i, i + DIGEST_CHUNK_HEIGHTS);
		const live = await spec.digestLive(chunk).execute(db);
		const next = await spec.digestNext(chunk).execute(db);
		differing.push(
			...diffDigests(live.rows as HeightDigest[], next.rows as HeightDigest[]),
		);
	}
	return differing;
}

async function windowCountDiffs(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	minHeight: number,
	copiedBelow: number,
): Promise<number[]> {
	const bad: number[] = [];
	for (
		let lo = minHeight;
		lo < copiedBelow;
		lo += LIVE_REWRITE_WINDOW_HEIGHTS
	) {
		const hi = Math.min(lo + LIVE_REWRITE_WINDOW_HEIGHTS, copiedBelow);
		const [a, b] = await Promise.all([
			liveCount(db, spec, lo, hi),
			nextCount(db, spec, lo, hi),
		]);
		if (a !== b) bad.push(lo);
	}
	return bad;
}

async function verify(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	opts: LiveRewriteRunOptions,
): Promise<number> {
	await requirePrepared(db, spec);
	if (!opts.apply) {
		opts.print(
			`${spec.table}: verify compares per-window counts and ${opts.sample} sampled digests; rerun with --apply`,
		);
		return 0;
	}
	await copyToTip(db, spec, { stampCopiedAt: false });
	await drainDirtyHeights(db, spec);
	const { copiedBelow, minHeight } = await readProgress(db, spec.table);
	if (minHeight === null) {
		opts.print(`${spec.table}: empty, nothing to verify`);
		return 0;
	}

	let badWindows = await windowCountDiffs(db, spec, minHeight, copiedBelow);
	if (badWindows.length > 0) {
		await drainDirtyHeights(db, spec);
		badWindows = await windowCountDiffs(db, spec, minHeight, copiedBelow);
	}
	const heights = await sampleHeights(db, spec, copiedBelow, opts.sample);
	let badHeights = await digestDiff(db, spec, heights);
	if (badHeights.length > 0) {
		await drainDirtyHeights(db, spec);
		badHeights = await digestDiff(db, spec, heights);
	}

	for (const lo of badWindows)
		opts.print(`count differs: window starting ${lo}`);
	for (const h of badHeights) opts.print(`digest differs: height ${h}`);
	if (badWindows.length > 0 || badHeights.length > 0) return 1;

	await sql`
		UPDATE live_rewrite_progress SET verified_at = now()
		 WHERE table_name = ${spec.table}
	`.execute(db);
	opts.print(
		`${spec.table}: verified ${heights.length} digests, counts equal below ${copiedBelow}`,
	);
	return 0;
}

async function preflight(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	opts: LiveRewriteRunOptions,
): Promise<number> {
	if (opts.apply) {
		await requirePrepared(db, spec);
		await copyToTip(db, spec, { stampCopiedAt: false });
		await drainDirtyHeights(db, spec);
	}
	const facts = await readLiveRewriteFacts(db, spec);
	const verdict = isLiveRewriteReady(facts);
	if (verdict.ready) {
		opts.print("READY");
		return 0;
	}
	for (const reason of verdict.reasons) opts.print(`NOT READY: ${reason}`);
	return 1;
}

async function abort(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	opts: LiveRewriteRunOptions,
): Promise<number> {
	opts.print(
		`drop triggers, function and ${nextTableName(spec.table)}; delete its progress and dirty rows`,
	);
	if (!opts.apply) return 0;
	await abortLiveRewrite(db, spec);
	opts.print(`${spec.table}: aborted`);
	return 0;
}

const HANDLERS: Record<
	LiveRewriteCommand,
	(
		db: LiveRewriteDb,
		spec: LiveRewriteSpec,
		opts: LiveRewriteRunOptions,
	) => Promise<number>
> = {
	prepare,
	copy,
	catchup,
	index: buildIndexes,
	verify,
	preflight,
	abort,
};

export function runLiveRewrite(
	db: LiveRewriteDb,
	spec: LiveRewriteSpec,
	command: LiveRewriteCommand,
	opts: LiveRewriteRunOptions,
): Promise<number> {
	return HANDLERS[command](db, spec, opts);
}

export type ParsedArgs = {
	table: string;
	command: LiveRewriteCommand;
	options: Omit<LiveRewriteRunOptions, "print">;
};

export function parseArgs(argv: string[]): ParsedArgs {
	let table: string | undefined;
	let command: LiveRewriteCommand | undefined;
	let apply = false;
	let maxWindows: number | undefined;
	let sample = DEFAULT_SAMPLE_HEIGHTS;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--table") table = argv[++i];
		else if (arg === "--apply") apply = true;
		else if (arg === "--max-windows") maxWindows = Number(argv[++i]);
		else if (arg === "--sample") sample = Number(argv[++i]);
		else if ((LIVE_REWRITE_COMMANDS as readonly string[]).includes(arg ?? "")) {
			command = arg as LiveRewriteCommand;
		} else throw new Error(`unknown argument: ${arg}`);
	}
	if (!table) throw new Error("--table is required");
	if (!command) {
		throw new Error(
			`a command is required: ${LIVE_REWRITE_COMMANDS.join(", ")}`,
		);
	}
	if (
		(maxWindows !== undefined &&
			!(Number.isInteger(maxWindows) && maxWindows > 0)) ||
		!(Number.isInteger(sample) && sample > 0)
	) {
		throw new Error("--max-windows and --sample must be positive integers");
	}
	return { table, command, options: { apply, maxWindows, sample } };
}

async function main(): Promise<number> {
	const { table, command, options } = parseArgs(process.argv.slice(2));
	const spec = LIVE_REWRITE_SPECS[table];
	if (!spec) {
		throw new Error(
			`no live-rewrite spec for "${table}" (known: ${Object.keys(LIVE_REWRITE_SPECS).join(", ") || "none"})`,
		);
	}
	const code = await runLiveRewrite(getSourceDb(), spec, command, {
		...options,
		print: (line) => console.log(line),
	});
	await closeDbOrTimeout();
	return code;
}

if (import.meta.main) {
	main()
		.then((code) => process.exit(code))
		.catch(async (err) => {
			console.error(
				"live-rewrite failed:",
				err instanceof Error ? (err.stack ?? err.message) : err,
			);
			await closeDbOrTimeout().catch(() => {});
			process.exit(1);
		});
}
