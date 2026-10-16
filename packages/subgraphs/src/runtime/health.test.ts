import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { bucketHourly } from "@secondlayer/shared";
import type { Database } from "@secondlayer/shared/db";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import {
	RETENTION_SWEEP_MS,
	SNAPSHOT_INTERVAL_MS,
	maybeRecordHealthSnapshot,
	resetHealthSnapshotState,
} from "./health.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";

const HAS_DB = !!process.env.DATABASE_URL;

const HOUR = 3_600_000;
// 12:30 UTC on a fixed day; the current bucket starts at 12:00.
const NOW = Date.UTC(2026, 9, 15, 12, 30, 0);

function point(
	atMs: number,
	fields: {
		tip?: number | null;
		cursor?: number | null;
		rows?: number | null;
		errors?: number;
		processed?: number;
	},
) {
	return {
		captured_at: new Date(atMs),
		chain_tip: fields.tip ?? null,
		last_processed_block: fields.cursor ?? null,
		rows_written_total: fields.rows ?? null,
		total_errors: fields.errors ?? 0,
		total_processed: fields.processed ?? 0,
	};
}

describe("bucketHourly", () => {
	test("lag is the max tip minus cursor within the hour", () => {
		const hours = bucketHourly(
			[
				point(NOW - 20 * 60_000, { tip: 1000, cursor: 990 }),
				point(NOW - 10 * 60_000, { tip: 1005, cursor: 980 }),
				point(NOW - 5 * 60_000, { tip: 1006, cursor: 1006 }),
			],
			3,
			NOW,
		);
		expect(hours).toHaveLength(3);
		expect(hours.at(-1)?.hour).toBe("2026-10-15T12:00:00.000Z");
		expect(hours.at(-1)?.lagBlocks).toBe(25);
	});

	test("a counter reset never yields a negative delta", () => {
		const hours = bucketHourly(
			[
				point(NOW - 25 * 60_000, { rows: 500, errors: 40, processed: 900 }),
				point(NOW - 15 * 60_000, { rows: 520, errors: 45, processed: 950 }),
				// Reindex / stats reset: all counters fall back to zero.
				point(NOW - 10 * 60_000, { rows: 0, errors: 0, processed: 0 }),
				point(NOW - 5 * 60_000, { rows: 7, errors: 1, processed: 10 }),
			],
			1,
			NOW,
		);
		expect(hours[0]).toMatchObject({
			rowsWritten: 27,
			errors: 6,
			eventsHandled: 60,
		});
	});

	test("growth across an hour boundary is counted once in the later hour", () => {
		const hours = bucketHourly(
			[
				point(NOW - HOUR + 10 * 60_000, { rows: 100 }),
				point(NOW - 20 * 60_000, { rows: 160 }),
			],
			2,
			NOW,
		);
		expect(hours[0]?.rowsWritten).toBe(0);
		expect(hours[1]?.rowsWritten).toBe(60);
	});

	test("an empty hour has null lag and zero deltas", () => {
		const hours = bucketHourly([], 2, NOW);
		expect(hours).toEqual([
			{
				hour: "2026-10-15T11:00:00.000Z",
				lagBlocks: null,
				rowsWritten: 0,
				errors: 0,
				eventsHandled: 0,
			},
			{
				hour: "2026-10-15T12:00:00.000Z",
				lagBlocks: null,
				rowsWritten: 0,
				errors: 0,
				eventsHandled: 0,
			},
		]);
	});
});

describe.skipIf(!HAS_DB)("maybeRecordHealthSnapshot (db)", () => {
	let db: Kysely<Database>;
	const schemaName = `subgraph_test_health_${randomUUID().slice(0, 8)}`;
	const subgraphName = `test-health-${randomUUID().slice(0, 8)}`;
	let subgraphId = "";

	const input = () => ({
		subgraphId,
		subgraphName,
		schemaName,
		lastProcessedBlock: 90,
		chainTip: 100,
		totalProcessed: 5,
		totalErrors: 1,
	});

	async function snapshots() {
		return db
			.selectFrom("subgraph_health_snapshots")
			.selectAll()
			.where("subgraph_id", "=", subgraphId)
			.orderBy("captured_at", "asc")
			.execute();
	}

	beforeEach(async () => {
		db ??= getDb();
		if (!subgraphId) {
			await sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`).execute(db);
			await sql
				.raw(`CREATE TABLE "${schemaName}"."t" (id int primary key)`)
				.execute(db);
			const row = await db
				.insertInto("subgraphs")
				.values({
					name: subgraphName,
					status: "active",
					definition: {},
					schema_hash: "test",
					handler_path: "test",
					schema_name: schemaName,
					account_id: randomUUID(),
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			subgraphId = row.id;
		}
		await db
			.deleteFrom("subgraph_health_snapshots")
			.where("subgraph_id", "=", subgraphId)
			.execute();
		resetHealthSnapshotState();
	});

	afterAll(async () => {
		if (!HAS_DB || !subgraphId) return;
		// Cascades to subgraph_health_snapshots.
		await db.deleteFrom("subgraphs").where("id", "=", subgraphId).execute();
		await sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).execute(db);
	});

	test("writes tip, rows and storage for an existing schema", async () => {
		await maybeRecordHealthSnapshot(db, input());
		const rows = await snapshots();
		expect(rows).toHaveLength(1);
		expect(Number(rows[0]?.chain_tip)).toBe(100);
		expect(rows[0]?.rows_written_total).not.toBeNull();
		expect(Number(rows[0]?.storage_bytes)).toBeGreaterThan(0);
	});

	test("two calls 10s apart write once; a call a minute later writes again", async () => {
		const t0 = Date.now();
		await maybeRecordHealthSnapshot(db, input(), t0);
		await maybeRecordHealthSnapshot(db, input(), t0 + 10_000);
		expect(await snapshots()).toHaveLength(1);

		await maybeRecordHealthSnapshot(db, input(), t0 + SNAPSHOT_INTERVAL_MS);
		expect(await snapshots()).toHaveLength(2);
	});

	test("the retention sweep deletes snapshots older than 7 days", async () => {
		await db
			.insertInto("subgraph_health_snapshots")
			.values({
				subgraph_id: subgraphId,
				total_processed: 1,
				total_errors: 0,
				last_processed_block: 1,
				captured_at: new Date(Date.now() - 8 * 24 * HOUR),
			})
			.execute();

		await maybeRecordHealthSnapshot(
			db,
			input(),
			Date.now() + RETENTION_SWEEP_MS,
		);

		const rows = await snapshots();
		expect(rows).toHaveLength(1);
		expect(Number(rows[0]?.chain_tip)).toBe(100);
	});

	test("a failing database never throws", async () => {
		const broken = {
			insertInto() {
				throw new Error("db down");
			},
		} as unknown as Kysely<Database>;
		await expect(
			maybeRecordHealthSnapshot(broken, { ...input(), schemaName: "nope" }),
		).resolves.toBeUndefined();
	});
});
