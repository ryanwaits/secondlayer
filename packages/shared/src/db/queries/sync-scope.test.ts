import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "kysely";
import { stage } from "../../coverage/evaluate.fixtures.ts";
import type { EvaluatorInput, SyncScope } from "../../coverage/evaluate.ts";
import { evaluateCoverage } from "../../coverage/evaluate.ts";
import { getDb } from "../index.ts";
import { findGaps } from "./integrity.ts";
import {
	InvalidSyncStartHeightError,
	getSyncScope,
	resolveSyncScope,
	syncStartHeightFromEnv,
	upsertSyncScope,
} from "./sync-scope.ts";

const FORWARD_ONLY_START = 8_000_000;

function forwardOnlyScope(): SyncScope {
	return {
		network: "mainnet",
		start_height: FORWARD_ONLY_START,
		target_height: null,
		bootstrap: {
			source: "archive",
			manifest_digest: "d".repeat(64),
			genesis_hash: null,
		},
	};
}

function evaluatorInput(args: {
	scope: SyncScope;
	target: number;
	ranges: { from_height: number; to_height: number }[];
	tip: number;
}): EvaluatorInput {
	return {
		scope: args.scope,
		stages: [stage({ id: "raw" })],
		runs: [
			{
				stage_id: "raw",
				code_hash: "code",
				config_hash: "cfg",
				handler_hash: null,
				target_height: args.target,
				target_cursor: null,
				status: "running",
				complete_through: null,
			},
		],
		evidence: [
			{
				stage_id: "raw",
				ranges: args.ranges,
				open_failures: [],
				cursor: null,
				queue: null,
				unanchored: false,
				unverified_import: false,
				source_available: true,
			},
		],
		source: {
			tip_height: args.tip,
			finalized_height: args.tip,
			observed_at: "2026-08-13T12:00:00.000Z",
		},
		options: { now: new Date("2026-08-13T12:00:00.000Z") },
	};
}

describe("syncStartHeightFromEnv", () => {
	test("reads a declared forward-only start", () => {
		expect(
			syncStartHeightFromEnv({ SECONDLAYER_SYNC_START_HEIGHT: "8000000" }),
		).toBe(8_000_000);
	});

	test("absent or blank means no declaration", () => {
		expect(syncStartHeightFromEnv({})).toBeNull();
		expect(
			syncStartHeightFromEnv({ SECONDLAYER_SYNC_START_HEIGHT: "  " }),
		).toBeNull();
	});

	test("a malformed height is refused rather than silently ignored", () => {
		expect(() =>
			syncStartHeightFromEnv({
				SECONDLAYER_SYNC_START_HEIGHT: "eight million",
			}),
		).toThrow(InvalidSyncStartHeightError);
		expect(() =>
			syncStartHeightFromEnv({ SECONDLAYER_SYNC_START_HEIGHT: "-1" }),
		).toThrow(InvalidSyncStartHeightError);
	});
});

describe("forward-only scope in the coverage evaluator", () => {
	test("history below the declared start is not a gap", () => {
		const report = evaluateCoverage(
			evaluatorInput({
				scope: forwardOnlyScope(),
				target: FORWARD_ONLY_START + 100,
				ranges: [
					{
						from_height: FORWARD_ONLY_START,
						to_height: FORWARD_ONLY_START + 100,
					},
				],
				tip: FORWARD_ONLY_START + 100,
			}),
		);
		const raw = report.stages[0];
		expect(raw.state).toBe("complete");
		expect(raw.gaps).toEqual([]);
		expect(raw.declared_range).toEqual({
			from_height: FORWARD_ONLY_START,
			to_height: FORWARD_ONLY_START + 100,
		});
	});

	test("a target below the declared start is out of scope, not a gap", () => {
		const report = evaluateCoverage(
			evaluatorInput({
				scope: forwardOnlyScope(),
				target: 4_000_000,
				ranges: [],
				tip: FORWARD_ONLY_START + 100,
			}),
		);
		expect(report.stages[0].state).toBe("out_of_scope");
	});
});

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("sync_scopes table", () => {
	// biome-ignore lint/suspicious/noExplicitAny: DB-gated suite; the null stand-in keeps the skipped path from constructing a pool
	const db = HAS_DB ? getDb() : (null as any);

	beforeEach(async () => {
		await sql`DELETE FROM sync_scopes`.execute(db);
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	afterAll(async () => {
		await sql`DELETE FROM sync_scopes`.execute(db);
		await sql`DELETE FROM events`.execute(db);
		await sql`DELETE FROM transactions`.execute(db);
		await sql`DELETE FROM blocks`.execute(db);
	});

	async function insertBlock(height: number) {
		await db
			.insertInto("blocks")
			.values({
				height,
				hash: `0x${height.toString(16).padStart(64, "0")}`,
				parent_hash: `0x${(height - 1).toString(16).padStart(64, "0")}`,
				burn_block_height: height,
				timestamp: Math.floor(Date.now() / 1000),
				canonical: true,
			})
			// biome-ignore lint/suspicious/noExplicitAny: kysely's onConflict builder is untyped in this test scope
			.onConflict((oc: any) => oc.column("height").doNothing())
			.execute();
	}

	test("a scope round-trips through the database unchanged", async () => {
		const scope = forwardOnlyScope();
		const written = await upsertSyncScope(db, scope);
		expect(written).toEqual(scope);
		expect(await getSyncScope(db, "mainnet")).toEqual(scope);
		expect(await resolveSyncScope(db, "mainnet")).toEqual(scope);
	});

	test("re-declaring the same network updates in place", async () => {
		await upsertSyncScope(db, forwardOnlyScope());
		const restated = {
			...forwardOnlyScope(),
			start_height: FORWARD_ONLY_START + 1_000,
			target_height: FORWARD_ONLY_START + 5_000,
		};
		await upsertSyncScope(db, restated);
		const rows = await db.selectFrom("sync_scopes").selectAll().execute();
		expect(rows).toHaveLength(1);
		expect(await getSyncScope(db, "mainnet")).toEqual(restated);
	});

	test("an unrecorded scope derives from the lowest stored block", async () => {
		for (const h of [500, 501, 502]) await insertBlock(h);
		const derived = await resolveSyncScope(db, "mainnet");
		expect(derived).toEqual({
			network: "mainnet",
			start_height: 500,
			target_height: null,
			bootstrap: {
				source: "import",
				manifest_digest: null,
				genesis_hash: null,
			},
		});
	});

	test("an unrecorded scope that reaches genesis names its genesis hash", async () => {
		for (const h of [0, 1, 2]) await insertBlock(h);
		const derived = await resolveSyncScope(db, "mainnet");
		expect(derived.start_height).toBe(0);
		expect(derived.bootstrap.source).toBe("genesis");
		expect(derived.bootstrap.genesis_hash).toBe(`0x${"0".repeat(64)}`);
	});

	test("the prefix below a forward-only start is never reported as a gap", async () => {
		for (const h of [FORWARD_ONLY_START, FORWARD_ONLY_START + 1]) {
			await insertBlock(h);
		}
		await upsertSyncScope(db, forwardOnlyScope());
		// findGaps walks stored heights pairwise, so it structurally cannot
		// invent a hole below the lowest row — the missing prefix is the scope's
		// business, not the gap scanner's.
		expect(await findGaps(db)).toEqual([]);
	});
});
