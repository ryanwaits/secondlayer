import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { parseTransaction } from "./parser.ts";
import type { TransactionPayload } from "./types/node-events.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const H = 991_500;

/**
 * The `function_args` double-encoding repair, end to end.
 *
 * Pre-2026-08-12 rows hold a jsonb *string* containing JSON because the writer
 * handed postgres a pre-serialized value. These pin both halves of the fix: the
 * parser now emits the array itself, and the backfill statement converts the
 * legacy rows without touching correct ones.
 */
describe.skipIf(!HAS_DB)("function_args double-encoding repair", () => {
	const db = HAS_DB ? getSourceDb() : null;

	async function clean() {
		if (!db) return;
		await sql`DELETE FROM events WHERE block_height = ${H}`.execute(db);
		await sql`DELETE FROM transactions WHERE block_height = ${H}`.execute(db);
		await sql`DELETE FROM blocks WHERE height = ${H}`.execute(db);
	}

	// This file's block sits above other suites' heights; leaving it behind
	// skews their MAX(height)-derived assertions.
	afterAll(clean);

	beforeEach(async () => {
		if (!db) return;
		await clean();
		await db
			.insertInto("blocks")
			.values({
				height: H,
				hash: "0xbfa",
				parent_hash: "0xbfa-parent",
				burn_block_height: H,
				timestamp: 1_700_000_000,
				canonical: true,
			})
			.execute();
	});

	async function insert(txId: string, functionArgs: unknown) {
		if (!db) throw new Error("missing db");
		await db
			.insertInto("transactions")
			.values({
				tx_id: txId,
				block_height: H,
				tx_index: 0,
				type: "contract_call",
				sender: "SP1",
				status: "success",
				contract_id: "SP1.c",
				function_name: "f",
				function_args: functionArgs as never,
				raw_tx: "0x00",
			})
			.execute();
	}

	async function typeOf(txId: string): Promise<string | null> {
		if (!db) throw new Error("missing db");
		const { rows } = await sql<{ t: string | null }>`
			SELECT jsonb_typeof(function_args) AS t
			FROM transactions WHERE tx_id = ${txId}
		`.execute(db);
		return rows[0]?.t ?? null;
	}

	/** The backfill's repair statement, applied to this test's height. */
	async function runBackfill(): Promise<number> {
		if (!db) throw new Error("missing db");
		const { rows } = await sql<{ repaired: number }>`
			UPDATE transactions AS t
				 SET function_args = (t.function_args #>> '{}')::jsonb
			 WHERE t.block_height = ${H}
				 AND t.function_args IS NOT NULL
				 AND jsonb_typeof(t.function_args) = 'string'
			RETURNING 1 AS repaired
		`.execute(db);
		return rows.length;
	}

	test("the parser writes a real jsonb array, not a string", async () => {
		if (!db) throw new Error("missing db");
		const payload = {
			txid: "0xparsed",
			tx_index: 0,
			status: "success",
			raw_tx: "0x00",
			tx_type: "contract_call",
			contract_call: {
				contract_id: "SP1.c",
				function_name: "f",
				function_args: ["0x0100000000000000000000000000000001"],
			},
		} as unknown as TransactionPayload;

		const parsed = await parseTransaction(payload, H, {
			skipApiFallback: true,
		});
		if (!parsed) throw new Error("parser returned null");
		expect(Array.isArray(parsed.function_args)).toBe(true);

		await db
			.insertInto("transactions")
			.values({ ...parsed, function_args: parsed.function_args as never })
			.execute();
		expect(await typeOf("0xparsed")).toBe("array");
	});

	test("backfill converts a double-encoded row into its array", async () => {
		if (!db) throw new Error("missing db");
		// Exactly what the old writer produced.
		await insert("0xlegacy", JSON.stringify(["0xaa", "0xbb"]));
		expect(await typeOf("0xlegacy")).toBe("string");

		expect(await runBackfill()).toBe(1);

		expect(await typeOf("0xlegacy")).toBe("array");
		const row = await db
			.selectFrom("transactions")
			.select("function_args")
			.where("tx_id", "=", "0xlegacy")
			.executeTakeFirstOrThrow();
		expect(row.function_args).toEqual(["0xaa", "0xbb"]);
	});

	test("backfill leaves correct rows untouched and is idempotent", async () => {
		if (!db) throw new Error("missing db");
		await insert("0xlegacy", JSON.stringify(["0xaa"]));
		await insert("0xcorrect", ["0xcc"]);
		await insert("0xempty", JSON.stringify([]));

		expect(await runBackfill()).toBe(2); // legacy + empty; not the correct one
		// Re-running finds nothing left to do — safe against overlapping runs.
		expect(await runBackfill()).toBe(0);

		expect(await typeOf("0xcorrect")).toBe("array");
		expect(await typeOf("0xempty")).toBe("array");
		const rows = await db
			.selectFrom("transactions")
			.select(["tx_id", "function_args"])
			.where("block_height", "=", H)
			.orderBy("tx_id")
			.execute();
		expect(rows.map((r) => r.function_args)).toEqual([["0xcc"], [], ["0xaa"]]);
	});

	test("a nested-JSON string argument survives the repair", async () => {
		if (!db) throw new Error("missing db");
		// A Clarity string-ascii arg whose content is itself JSON — the case where
		// a naive unwrap could strip a level too many.
		const args = ['{"not":"a real array"}', "0xbb"];
		await insert("0xnested", JSON.stringify(args));
		expect(await runBackfill()).toBe(1);
		const row = await db
			.selectFrom("transactions")
			.select("function_args")
			.where("tx_id", "=", "0xnested")
			.executeTakeFirstOrThrow();
		expect(row.function_args).toEqual(args);
	});
});
