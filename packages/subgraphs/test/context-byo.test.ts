import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import {
	type BlockMeta,
	SubgraphContext,
	type TxMeta,
} from "../src/runtime/context.ts";
import type { SubgraphSchema } from "../src/types.ts";

// Real-DB test: proves the BYO replace-per-height flag makes block reprocessing
// idempotent (a BYO flush can't share the managed block tx, so crashes replay).
const SKIP = !process.env.DATABASE_URL;
const PG_SCHEMA = "subgraph_byo_idem_test";

const schema: SubgraphSchema = {
	transfers: {
		columns: { sender: { type: "principal" }, amount: { type: "uint" } },
	},
};

const tx: TxMeta = {
	txId: "0xtx1",
	sender: "SP1",
	type: "contract_call",
	status: "success",
};

function blockAt(height: number): BlockMeta {
	return {
		height,
		hash: `0x${height}`,
		timestamp: 1700000000,
		burnBlockHeight: 1,
	};
}

/** Re-run a fresh ctx for the same block — simulates a crash-replay of one block. */
async function flushBlock(height: number, byo: boolean) {
	const ctx = new SubgraphContext(
		getDb(),
		PG_SCHEMA,
		schema,
		blockAt(height),
		tx,
		byo,
	);
	ctx.insert("transfers", { sender: "SP1", amount: 100 });
	ctx.insert("transfers", { sender: "SP2", amount: 200 });
	await ctx.flush();
}

async function countAt(height: number): Promise<number> {
	const rows = await getRawClient().unsafe(
		`SELECT count(*)::int AS n FROM "${PG_SCHEMA}".transfers WHERE _block_height = ${height}`,
	);
	return (rows[0] as { n: number }).n;
}

describe.skipIf(SKIP)("BYO replace-per-height idempotency", () => {
	beforeAll(async () => {
		const c = getRawClient();
		await c.unsafe(`DROP SCHEMA IF EXISTS "${PG_SCHEMA}" CASCADE`);
		await c.unsafe(`CREATE SCHEMA "${PG_SCHEMA}"`);
		await c.unsafe(
			`CREATE TABLE "${PG_SCHEMA}".transfers (
				id bigserial PRIMARY KEY,
				sender text, amount numeric,
				_block_height int, _tx_id text, _created_at timestamptz
			)`,
		);
	});

	afterAll(async () => {
		await getRawClient().unsafe(`DROP SCHEMA IF EXISTS "${PG_SCHEMA}" CASCADE`);
	});

	test("BYO flush replayed for the same block does not duplicate", async () => {
		await flushBlock(100, true);
		await flushBlock(100, true); // crash-replay
		expect(await countAt(100)).toBe(2);
	});

	test("managed flush replayed duplicates (control — needs the managed tx)", async () => {
		await flushBlock(200, false);
		await flushBlock(200, false);
		expect(await countAt(200)).toBe(4);
	});
});
