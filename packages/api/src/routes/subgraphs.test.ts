import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type { SubgraphOperation } from "@secondlayer/shared/db";
import {
	pgSchemaName,
	registerSubgraph,
} from "@secondlayer/shared/db/queries/subgraphs";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import subgraphsRouter, {
	buildSyncInfo,
	cache,
	deriveOperationProgress,
} from "./subgraphs.ts";

const NO_GAPS = { count: 0, totalMissingBlocks: 0, ranges: [] };

function reindexingLive(
	overrides: Partial<{ lastProcessedBlock: number }> = {},
) {
	return {
		status: "reindexing",
		start_block: null,
		last_processed_block: overrides.lastProcessedBlock ?? 100,
		reindex_from_block: 0,
		reindex_to_block: 1000,
	};
}

describe("buildSyncInfo", () => {
	test("queued op: shows queue position + estimated start, no etaSeconds", () => {
		const info = buildSyncInfo(reindexingLive(), 1000, NO_GAPS, "complete", {
			status: "queued",
			estimatedEvents: 5000,
			processedEvents: null,
			startedAt: null,
			queuePosition: 2,
			medianDurationSeconds: 60,
		});
		expect(info.queue).toEqual({
			position: 2,
			estimatedEvents: 5000,
			estimatedStartSeconds: 120,
		});
		expect(info.etaSeconds).toBeUndefined();
	});

	test("running op with event estimate: computes etaSeconds from event rate", () => {
		const startedAt = new Date(Date.now() - 60_000); // 60s ago
		const info = buildSyncInfo(reindexingLive(), 1000, NO_GAPS, "complete", {
			status: "running",
			estimatedEvents: 1000,
			processedEvents: 100, // 100 events / 60s = ~1.67/s
			startedAt,
			queuePosition: null,
			medianDurationSeconds: null,
		});
		// (1000 - 100) / (100/60) = 540s
		expect(info.etaSeconds).toBe(540);
	});

	test("running op with event estimate but under the 30s floor: no etaSeconds yet", () => {
		const startedAt = new Date(Date.now() - 5_000); // 5s ago
		const info = buildSyncInfo(reindexingLive(), 1000, NO_GAPS, "complete", {
			status: "running",
			estimatedEvents: 1000,
			processedEvents: 50,
			startedAt,
			queuePosition: null,
			medianDurationSeconds: null,
		});
		expect(info.etaSeconds).toBeNull();
	});

	test("running op with NO event estimate (heavy op): falls back to block-rate etaSeconds", () => {
		const startedAt = new Date(Date.now() - 100_000); // 100s ago
		// processedBlocks is inclusive: lastProcessedBlock(100) - startBlock(0) + 1 = 101
		// blocks in 100s ≈ 1.01 blk/s; blocksRemaining = 1000 - 100 = 900 → eta ≈ 891s.
		const info = buildSyncInfo(
			reindexingLive({ lastProcessedBlock: 100 }),
			1000,
			NO_GAPS,
			"complete",
			{
				status: "running",
				estimatedEvents: null,
				processedEvents: null,
				startedAt,
				queuePosition: null,
				medianDurationSeconds: null,
			},
		);
		expect(info.estimatedEvents).toBeUndefined();
		expect(info.etaSeconds).toBe(891);
	});

	test("running op with no estimate and under the 30s floor: no etaSeconds yet", () => {
		const startedAt = new Date(Date.now() - 5_000);
		const info = buildSyncInfo(
			reindexingLive({ lastProcessedBlock: 100 }),
			1000,
			NO_GAPS,
			"complete",
			{
				status: "running",
				estimatedEvents: null,
				processedEvents: null,
				startedAt,
				queuePosition: null,
				medianDurationSeconds: null,
			},
		);
		expect(info.etaSeconds).toBeNull();
	});

	test("running op with no estimate and zero blocks processed: no etaSeconds (avoids div-by-zero)", () => {
		const startedAt = new Date(Date.now() - 60_000);
		const info = buildSyncInfo(
			reindexingLive({ lastProcessedBlock: -1 }), // processedBlocks clamps to 0
			1000,
			NO_GAPS,
			"complete",
			{
				status: "running",
				estimatedEvents: null,
				processedEvents: null,
				startedAt,
				queuePosition: null,
				medianDurationSeconds: null,
			},
		);
		expect(info.etaSeconds).toBeNull();
	});

	test("no active op: no queue/estimate/eta fields at all", () => {
		const info = buildSyncInfo(
			reindexingLive(),
			1000,
			NO_GAPS,
			"complete",
			undefined,
		);
		expect(info.queue).toBeUndefined();
		expect(info.estimatedEvents).toBeUndefined();
		expect(info.etaSeconds).toBeUndefined();
	});
});

// ── deriveOperationProgress ─────────────────────────────────────────────

function operation(overrides: Record<string, unknown> = {}): SubgraphOperation {
	return {
		id: "op-1",
		subgraph_id: "sg-1",
		subgraph_name: "bns-names",
		account_id: null,
		kind: "backfill",
		status: "running",
		from_block: 1000,
		to_block: 1999,
		cancel_requested: false,
		locked_by: null,
		locked_until: null,
		started_at: null,
		finished_at: null,
		processed_blocks: null,
		error: null,
		created_at: new Date(),
		updated_at: new Date(),
		weight: "heavy",
		estimated_events: null,
		processed_events: null,
		cursor_block: null,
		...overrides,
	} as SubgraphOperation;
}

describe("deriveOperationProgress", () => {
	test("a running backfill reports progress from its cursor checkpoint", () => {
		// The whole point of the fallback: a backfill writes neither
		// processed_events (reindex-only flush) nor processed_blocks (terminal
		// only), so without the cursor it reports null for its entire run.
		const op = operation({ cursor_block: 1499 });
		expect(deriveOperationProgress(op, 1000, 1000)).toBe(0.5);
	});

	test("the cursor counts inclusively — its own block is committed", () => {
		expect(
			deriveOperationProgress(operation({ cursor_block: 1000 }), 1000, 1000),
		).toBe(0.001);
	});

	test("a cursor behind the range floors at zero instead of going negative", () => {
		const op = operation({ cursor_block: 500 });
		expect(deriveOperationProgress(op, 1000, 1000)).toBe(0);
	});

	test("event counts win over the cursor when the estimate exists", () => {
		const op = operation({
			estimated_events: 400,
			processed_events: 100,
			cursor_block: 1900,
		});
		expect(deriveOperationProgress(op, 1000, 1000)).toBe(0.25);
	});

	test("a completed op is 1 even with no progress signal recorded", () => {
		expect(
			deriveOperationProgress(operation({ status: "completed" }), 1000, 1000),
		).toBe(1);
	});

	test("null when the op has reported nothing at all", () => {
		expect(deriveOperationProgress(operation(), 1000, 1000)).toBeNull();
	});
});

describe.skipIf(!process.env.DATABASE_URL)(
	"subgraph health history and error groups routes",
	() => {
		const db = getDb();
		const name = `health-test-${crypto.randomUUID().slice(0, 8)}`;
		let subgraphId = "";

		function app() {
			const a = new Hono();
			a.onError(errorHandler);
			a.route("/api/subgraphs", subgraphsRouter);
			return a;
		}

		beforeAll(async () => {
			const row = await registerSubgraph(db, {
				name,
				version: "1.0.0",
				definition: {},
				schemaHash: "h",
				handlerPath: "/data/subgraphs/x.js",
			});
			subgraphId = row.id;
			const now = Date.now();
			await db
				.insertInto("subgraph_health_snapshots")
				.values([
					{
						subgraph_id: subgraphId,
						total_processed: 10,
						total_errors: 1,
						last_processed_block: 90,
						chain_tip: 100,
						rows_written_total: 5,
						storage_bytes: 1024,
						captured_at: new Date(now - 20 * 60_000),
					},
					{
						subgraph_id: subgraphId,
						total_processed: 30,
						total_errors: 4,
						last_processed_block: 99,
						chain_tip: 100,
						rows_written_total: 45,
						storage_bytes: 2048,
						captured_at: new Date(now - 10 * 60_000),
					},
				])
				.execute();
			await db
				.insertInto("subgraph_error_groups")
				.values([
					{
						subgraph_name: name,
						fingerprint: "a",
						source_name: "burns",
						event_type: "ft_burn",
						message: "rare",
						frame: "handlers.ts:1",
						count: 2,
						sample_tx_id: null,
						sample_block_height: null,
					},
					{
						subgraph_name: name,
						fingerprint: "b",
						source_name: "burns",
						event_type: "ft_burn",
						message: "common",
						frame: "handlers.ts:42",
						count: 90,
						sample_tx_id: "0xabc",
						sample_block_height: 77,
					},
				])
				.execute();
			await cache.refresh();
		});

		afterAll(async () => {
			await db
				.deleteFrom("subgraph_error_groups")
				.where("subgraph_name", "=", name)
				.execute();
			// Cascades to subgraph_health_snapshots.
			await db.deleteFrom("subgraphs").where("name", "=", name).execute();
		});

		test("404 for an unknown subgraph", async () => {
			const health = await app().request("/api/subgraphs/nope-xyz/health");
			const errors = await app().request("/api/subgraphs/nope-xyz/errors");
			expect(health.status).toBe(404);
			expect(errors.status).toBe(404);
		});

		test("health rejects hours outside 1-168", async () => {
			for (const hours of ["0", "169", "abc", "1.5"]) {
				const res = await app().request(
					`/api/subgraphs/${name}/health?hours=${hours}`,
				);
				expect(res.status).toBe(400);
			}
		});

		test("health returns hourly buckets with lag and deltas", async () => {
			const res = await app().request(`/api/subgraphs/${name}/health?hours=3`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				hours: {
					hour: string;
					lagBlocks: number | null;
					rowsWritten: number;
					errors: number;
				}[];
				errors24h: number;
			};
			expect(body.hours).toHaveLength(3);
			expect(body.hours.some((h) => h.lagBlocks !== null)).toBe(true);
			expect(body.hours.reduce((sum, h) => sum + h.rowsWritten, 0)).toBe(40);
			expect(body.errors24h).toBe(3);
		});

		test("the list carries each subgraph's health on request, matching the single read", async () => {
			const list = await app().request("/api/subgraphs?health=3");
			expect(list.status).toBe(200);
			const { data } = (await list.json()) as {
				data: { name: string; health?: { hours: unknown[] } }[];
			};
			const item = data.find((s) => s.name === name);
			expect(item?.health?.hours).toHaveLength(3);
			const single = await app().request(
				`/api/subgraphs/${name}/health?hours=3`,
			);
			expect(item?.health).toEqual(
				(await single.json()) as { hours: unknown[] },
			);
		});

		test("the list has no health key unless asked", async () => {
			const res = await app().request("/api/subgraphs");
			const { data } = (await res.json()) as {
				data: Record<string, unknown>[];
			};
			expect(data.length).toBeGreaterThan(0);
			for (const item of data) expect("health" in item).toBe(false);
		});

		test("the list rejects a health window outside 1-168", async () => {
			for (const hours of ["0", "169", "abc", "1.5"]) {
				const res = await app().request(`/api/subgraphs?health=${hours}`);
				expect(res.status).toBe(400);
			}
		});

		test("errors are ordered by count with camelCase fields", async () => {
			const res = await app().request(`/api/subgraphs/${name}/errors`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { data: Record<string, unknown>[] };
			expect(body.data.map((g) => g.message)).toEqual(["common", "rare"]);
			expect(body.data[0]).toMatchObject({
				frame: "handlers.ts:42",
				eventType: "ft_burn",
				sourceName: "burns",
				count: 90,
				sampleTxId: "0xabc",
				sampleBlockHeight: 77,
			});
		});

		test("detail reports per-table and total storage bytes", async () => {
			const detailName = `storage-test-${crypto.randomUUID().slice(0, 8)}`;
			const schema = pgSchemaName(detailName);
			await registerSubgraph(db, {
				name: detailName,
				version: "1.0.0",
				definition: {
					schema: { things: { columns: { a: { type: "text" } } } },
				},
				schemaHash: "h",
				handlerPath: "/data/subgraphs/x.js",
			});
			await sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schema}"`).execute(db);
			await sql
				.raw(`CREATE TABLE "${schema}"."things" (a text, _id serial)`)
				.execute(db);
			try {
				await cache.refresh();
				const res = await app().request(`/api/subgraphs/${detailName}`);
				expect(res.status).toBe(200);
				const body = (await res.json()) as {
					storageBytes?: number;
					tables: Record<string, { storageBytes?: number }>;
				};
				expect(body.tables.things?.storageBytes).toBeGreaterThan(0);
				expect(body.storageBytes).toBe(body.tables.things?.storageBytes);
			} finally {
				await db
					.deleteFrom("subgraphs")
					.where("name", "=", detailName)
					.execute();
				await sql.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).execute(db);
				await cache.refresh();
			}
		});

		test("errors limit is applied", async () => {
			const res = await app().request(`/api/subgraphs/${name}/errors?limit=1`);
			const body = (await res.json()) as { data: unknown[] };
			expect(body.data).toHaveLength(1);
		});
	},
);
