import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { EventsEnvelope, IndexReorg, IndexTip } from "../index.ts";
import { Index } from "../index.ts";
import { kyselySink } from "../sinks/kysely.ts";
import type { ConsumerSink } from "../sinks/types.ts";
import { createStreamsClient } from "../streams/client.ts";

/**
 * The sink acceptance harness: the reorg-demo fork script (chain forks at
 * block 102) run against `kyselySink` with ZERO user reorg code, plus fault
 * injection proving rows+cursor atomicity. Requires the dev Postgres
 * (`bun run db`, binds 127.0.0.1:5440); skips cleanly when absent.
 */

const DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

interface Database {
	sink_test_sales: {
		cursor: string;
		block_height: number;
		buyer: string;
	};
	sl_consumer_checkpoints: { id: string; cursor: string };
}

const db = new Kysely<Database>({
	dialect: new PostgresDialect({
		pool: new pg.Pool({ connectionString: DATABASE_URL, max: 4 }),
	}),
});

/**
 * Reachability, not just configuration — this suite owns the sink's entire
 * correctness story (rows+cursor atomicity, the advisory lock, reorg rollback),
 * so it must never report success by skipping. Locally, no database means skip.
 * In CI it means fail: a green check for proofs that never ran is worse than a
 * red one.
 */
const dbUp = await sql`SELECT 1`
	.execute(db)
	.then(() => true)
	.catch((err) => {
		if (process.env.CI) {
			throw new Error(
				`kysely sink suite cannot reach Postgres at ${DATABASE_URL}: ${
					err instanceof Error ? err.message : String(err)
				}. In CI this is a failure — skipping would report success for the atomicity, advisory-lock, and reorg-rollback proofs.`,
			);
		}
		return false;
	});

const TIP: IndexTip = {
	block_height: 103,
	finalized_height: 99,
	lag_seconds: 0,
};

function ev(cursor: string, block_height: number, buyer: string) {
	return {
		cursor,
		block_height,
		tx_id: `0x${buyer}`,
		tx_index: 0,
		event_index: 0,
		event_type: "ft_transfer" as const,
		contract_id: "SP1.token",
		asset_identifier: "SP1.token::t",
		sender: "SP1",
		recipient: buyer,
		amount: "1",
	};
}

const REORG: IndexReorg = {
	id: "fork-102",
	detected_at: "2026-07-30T00:00:00.000Z",
	fork_point_height: 102,
	old_index_block_hash: "0xold",
	new_index_block_hash: "0xnew",
	orphaned_range: { from: "102:0", to: "103:0" },
	new_canonical_tip: "102:0",
};

/** The reorg-demo script as a cursor-keyed fake feed: CAROL@102 + DAVE@103
 *  get orphaned; ERIN@102 is the new canonical truth. */
function forkScriptFetch(): (
	input: string | URL | Request,
) => Promise<Response> {
	const REWIND = "101:2147483647";
	return async (input) => {
		const url = new URL(input.toString());
		const cursor = url.searchParams.get("cursor");
		let body: EventsEnvelope;
		if (cursor === null) {
			body = {
				events: [ev("100:0", 100, "ALICE"), ev("101:0", 101, "BOB")],
				next_cursor: "101:0",
				tip: TIP,
				reorgs: [],
			};
		} else if (cursor === "101:0") {
			body = {
				events: [ev("102:0", 102, "CAROL"), ev("103:0", 103, "DAVE")],
				next_cursor: "103:0",
				tip: TIP,
				reorgs: [],
			};
		} else if (cursor === "103:0") {
			// The fork lands: everything >= 102 is no longer canonical.
			body = { events: [], next_cursor: "103:0", tip: TIP, reorgs: [REORG] };
		} else if (cursor === REWIND) {
			// Re-read from the fork foot — the same reorg is re-reported and
			// must not re-trigger a rollback.
			body = {
				events: [ev("102:0", 102, "ERIN")],
				next_cursor: "102:0",
				tip: TIP,
				reorgs: [REORG],
			};
		} else {
			body = { events: [], next_cursor: cursor, tip: TIP, reorgs: [REORG] };
		}
		return Response.json(body);
	};
}

function makeSink() {
	return kyselySink(db, {
		id: "sink-test-sales",
		tables: ["sink_test_sales"],
		height: "block_height",
	});
}

async function rows(): Promise<Array<{ block_height: number; buyer: string }>> {
	return db
		.selectFrom("sink_test_sales")
		.select(["block_height", "buyer"])
		.orderBy("block_height")
		.execute();
}

async function checkpoint(): Promise<string | null> {
	const row = await db
		.selectFrom("sl_consumer_checkpoints")
		.select("cursor")
		.where("id", "=", "sink-test-sales")
		.executeTakeFirst()
		.catch(() => undefined);
	return row?.cursor ?? null;
}

beforeEach(async () => {
	if (!dbUp) return;
	await sql`
		DROP TABLE IF EXISTS sink_test_sales;
		CREATE TABLE sink_test_sales (
			cursor text PRIMARY KEY,
			block_height integer NOT NULL,
			buyer text NOT NULL
		);
		CREATE TABLE IF NOT EXISTS sl_consumer_checkpoints (id text PRIMARY KEY, cursor text NOT NULL);
		DELETE FROM sl_consumer_checkpoints WHERE id = 'sink-test-sales';
	`.execute(db);
});

afterAll(async () => {
	if (dbUp) {
		await sql`DROP TABLE IF EXISTS sink_test_sales`.execute(db);
	}
	await db.destroy();
});

describe.skipIf(!dbUp)("kyselySink acceptance (fork at block 102)", () => {
	test("survives the reorg with ZERO user reorg code — no gaps, no orphans", async () => {
		const client = new Index({ fetchImpl: forkScriptFetch() });

		await client.events.consume({
			eventType: "ft_transfer",
			fromHeight: 100,
			sink: makeSink(),
			maxEmptyPolls: 1,
			emptyBackoffMs: 0,
			// No onReorg. No checkpoint code. Just the writes:
			onBatch: async (events, _envelope, ctx) => {
				if (events.length === 0) return;
				await ctx.tx
					.insertInto("sink_test_sales")
					.values(
						events.map((e) => ({
							cursor: e.cursor,
							block_height: e.block_height,
							buyer: e.recipient,
						})),
					)
					.onConflict((oc) => oc.column("cursor").doNothing())
					.execute();
			},
		});

		// CAROL and DAVE (the orphaned fork) are gone; ERIN is the truth.
		expect(await rows()).toEqual([
			{ block_height: 100, buyer: "ALICE" },
			{ block_height: 101, buyer: "BOB" },
			{ block_height: 102, buyer: "ERIN" },
		]);
		expect(await checkpoint()).toBe("102:0");
	});

	test("a handler throw aborts rows AND cursor — the batch is re-read on restart", async () => {
		const client = new Index({ fetchImpl: forkScriptFetch() });
		let crashes = 0;

		const attempt = client.events.consume({
			eventType: "ft_transfer",
			fromHeight: 100,
			sink: makeSink(),
			maxEmptyPolls: 1,
			emptyBackoffMs: 0,
			onBatch: async (events, _envelope, ctx) => {
				await ctx.tx
					.insertInto("sink_test_sales")
					.values(
						events.map((e) => ({
							cursor: e.cursor,
							block_height: e.block_height,
							buyer: e.recipient,
						})),
					)
					.execute();
				// Crash AFTER the insert — the classic torn-batch moment.
				crashes++;
				throw new Error("kill -9");
			},
		});
		await expect(attempt).rejects.toThrow("kill -9");
		expect(crashes).toBe(1);

		// Nothing committed: no rows, no cursor. The batch never half-landed.
		expect(await rows()).toEqual([]);
		expect(await checkpoint()).toBeNull();

		// Restart with a clean handler: resumes from scratch and re-reads the
		// exact same page — at-least-once, zero loss.
		await client.events.consume({
			eventType: "ft_transfer",
			fromHeight: 100,
			sink: makeSink(),
			maxEmptyPolls: 1,
			emptyBackoffMs: 0,
			onBatch: async (events, _e, ctx) => {
				if (events.length === 0) return;
				await ctx.tx
					.insertInto("sink_test_sales")
					.values(
						events.map((e) => ({
							cursor: e.cursor,
							block_height: e.block_height,
							buyer: e.recipient,
						})),
					)
					.onConflict((oc) => oc.column("cursor").doNothing())
					.execute();
			},
		});
		expect((await rows()).map((r) => r.buyer)).toEqual([
			"ALICE",
			"BOB",
			"ERIN",
		]);
	});

	test("resumes from the sink's committed cursor, ignoring fromHeight", async () => {
		const sink = makeSink();
		// Seed a committed checkpoint past the first page.
		await sink.loadCursor();
		await sink.commitBatch("101:0", async () => {});

		const requested: Array<string | null> = [];
		const client = new Index({
			fetchImpl: async (input) => {
				const url = new URL(input.toString());
				requested.push(url.searchParams.get("cursor"));
				return Response.json({
					events: [],
					next_cursor: url.searchParams.get("cursor"),
					tip: TIP,
					reorgs: [],
				});
			},
		});

		await client.events.consume({
			eventType: "ft_transfer",
			fromHeight: 0,
			sink,
			maxEmptyPolls: 1,
			emptyBackoffMs: 0,
			onBatch: () => {},
		});
		expect(requested).toEqual(["101:0"]);
	});

	test("a missing height column fails loudly at first use, not silently at reorg time", async () => {
		await sql`
			DROP TABLE IF EXISTS sink_test_sales;
			CREATE TABLE sink_test_sales (cursor text PRIMARY KEY, buyer text NOT NULL)
		`.execute(db);
		const sink = kyselySink(db, {
			id: "sink-test-sales",
			tables: ["sink_test_sales"],
			// biome-ignore lint/suspicious/noExplicitAny: deliberately defeating the compile-time check to prove the runtime one
			height: "block_height" as any,
		});
		await expect(sink.loadCursor()).rejects.toThrow(/height/);
	});

	test("a second consumer with the same id fails loudly instead of interleaving", async () => {
		const sink = makeSink();
		await sink.loadCursor();

		// Hold the advisory lock in an open transaction on another connection.
		let release: (() => void) | undefined;
		const held = new Promise<void>((r) => {
			release = r;
		});
		const holder = db.transaction().execute(async (tx) => {
			await sql`SELECT pg_advisory_xact_lock(hashtextextended('sink-test-sales', 0))`.execute(
				tx,
			);
			await held;
		});
		// Give the holder a moment to acquire.
		await new Promise((r) => setTimeout(r, 50));

		await expect(sink.commitBatch("1:0", async () => {})).rejects.toThrow(
			/another consumer/,
		);
		release?.();
		await holder;
	});
});

// NOTE: a "flagship example stays under 70 code lines" gate lived here and was
// removed with examples/. The invariant it protected is real — the sink exists
// to delete user code — so restore this gate against the new example when the
// self-host-aligned examples land.

describe("sink initialization", () => {
	test("an explicit fromCursor still initializes the sink", async () => {
		const calls: string[] = [];
		const sink: ConsumerSink<unknown> = {
			async loadCursor() {
				calls.push("loadCursor");
				return "1:0";
			},
			async commitBatch(_cursor, apply) {
				calls.push("commitBatch");
				await apply({} as never);
			},
			async rollback() {
				calls.push("rollback");
			},
		};

		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						events: [],
						next_cursor: null,
						tip: {
							block_height: 10,
							block_hash: "0x1",
							burn_block_height: 20,
							lag_seconds: 0,
						},
						reorgs: [],
					}),
					{ headers: { "content-type": "application/json" } },
				),
		});

		// `loadCursor` doubles as the sink's init (checkpoint DDL + the
		// height-column precondition). Skipping it on an explicit cursor made
		// the first commit fail against a table that was never created.
		await client.events.consume({
			fromCursor: "5:0",
			mode: "bounded",
			maxPages: 1,
			sink,
			onBatch: () => {},
		});

		expect(calls).toContain("loadCursor");
	});
});
