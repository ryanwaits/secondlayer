import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import type { SubgraphSchema } from "../types.ts";
import { type BlockMeta, SubgraphContext, type TxMeta } from "./context.ts";
import { MemoryStore, MemorySubgraphContext } from "./memory-store.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const schema = {
	reserves: {
		columns: { token: { type: "text" }, amount: { type: "uint" } },
		uniqueKeys: [["token"]],
	},
} as unknown as SubgraphSchema;

const blockAt = (height: number): BlockMeta => ({
	height,
	hash: `0x${height}`,
	timestamp: 1_735_000_000 + height,
	burnBlockHeight: 875_000,
});
const txN = (n: number): TxMeta => ({
	txId: `0xtx${n}`,
	sender: "SP1",
	type: "contract_call",
	status: "success",
});

type Write = (ctx: SubgraphContext) => void;

/**
 * Two blocks of handler writes, one tx at a time. Block 1 is the replay
 * fixture's shape (reserve[token-abtc] written by tx1 then tx2) plus the
 * other same-block cases: coalesced and UPDATE-path increments, delete then
 * re-create, and an upsert after an increment. Block 2 rewrites keys block 1
 * created.
 */
const BLOCKS: { height: number; txs: Write[] }[] = [
	{
		height: 1_230_195,
		txs: [
			(ctx) => {
				ctx.increment("reserves", { token: "alex" }, { amount: 5n });
				ctx.upsert("reserves", { token: "abtc" }, { amount: 10n });
				ctx.upsert("reserves", { token: "wstx" }, { amount: 1n });
				ctx.upsert("reserves", { token: "wkiki" }, { amount: 1n });
			},
			(ctx) => {
				ctx.upsert("reserves", { token: "abtc" }, { amount: 11n });
				ctx.increment("reserves", { token: "alex" }, { amount: 7n });
				ctx.delete("reserves", { token: "wstx" });
				ctx.increment("reserves", { token: "wkiki" }, { amount: 2n });
				ctx.increment("reserves", { token: "usda" }, { amount: 1n });
			},
			(ctx) => {
				ctx.increment("reserves", { token: "usda" }, { amount: 2n });
				ctx.upsert("reserves", { token: "wstx" }, { amount: 3n });
				ctx.upsert("reserves", { token: "wkiki" }, { amount: 9n });
			},
		],
	},
	{
		height: 1_230_196,
		txs: [
			(ctx) => {
				ctx.upsert("reserves", { token: "abtc" }, { amount: 12n });
				ctx.increment("reserves", { token: "alex" }, { amount: 1n });
				ctx.upsert("reserves", { token: "usdc" }, { amount: 5n });
			},
			(ctx) => {
				ctx.upsert("reserves", { token: "usdc" }, { amount: 6n });
			},
		],
	},
];

/** Run every block's txs through a per-block context, numbering txs globally. */
async function runBlocks(
	makeCtx: (block: BlockMeta, tx: TxMeta) => SubgraphContext,
	commit: (ctx: SubgraphContext) => Promise<unknown>,
): Promise<void> {
	let n = 0;
	for (const { height, txs } of BLOCKS) {
		const ctx = makeCtx(blockAt(height), txN(n + 1));
		for (const write of txs) {
			ctx.setTx(txN(++n));
			write(ctx);
		}
		await commit(ctx);
	}
}

const project = (rows: Record<string, unknown>[]) =>
	rows
		.map((r) => ({
			token: String(r.token),
			amount: String(r.amount),
			_block_height: String(r._block_height),
			_tx_id: String(r._tx_id),
		}))
		.sort((a, b) => a.token.localeCompare(b.token));

let db: Kysely<Database>;
let pgSchemaName: string;

beforeAll(async () => {
	db = getDb();
	pgSchemaName = `sg_parity_test_${randomUUID().slice(0, 8)}`;
	await sql.raw(`CREATE SCHEMA "${pgSchemaName}"`).execute(db);
	await sql
		.raw(
			`CREATE TABLE "${pgSchemaName}"."reserves" (
				_id BIGSERIAL PRIMARY KEY,
				token TEXT NOT NULL,
				amount NUMERIC(78, 0),
				_block_height BIGINT NOT NULL,
				_tx_id TEXT NOT NULL,
				_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE (token)
			)`,
		)
		.execute(db);
});

afterAll(async () => {
	await sql.raw(`DROP SCHEMA IF EXISTS "${pgSchemaName}" CASCADE`).execute(db);
});

describe("Postgres flush and memory store hold identical rows", () => {
	it("system columns keep the creating write within a block and across blocks", async () => {
		await runBlocks(
			(block, tx) => new SubgraphContext(db, pgSchemaName, schema, block, tx),
			(ctx) => ctx.flush(),
		);
		const { rows } = await sql
			.raw(`SELECT * FROM "${pgSchemaName}"."reserves"`)
			.execute(db);
		const postgres = project(rows as Record<string, unknown>[]);

		const store = new MemoryStore();
		await runBlocks(
			(block, tx) => new MemorySubgraphContext(store, schema, block, tx),
			(ctx) => (ctx as MemorySubgraphContext).commitOps(),
		);
		const memory = project(store.tables.get("reserves") ?? []);

		expect(postgres).toEqual(memory);
		const row = (
			token: string,
			amount: string,
			height: number,
			tx: number,
		) => ({
			token,
			amount,
			_block_height: String(height),
			_tx_id: `0xtx${tx}`,
		});
		expect(postgres).toEqual([
			// tx1 created it in 1,230,195; tx2 and block 2's tx4 only moved amount.
			row("abtc", "12", 1_230_195, 1),
			row("alex", "13", 1_230_195, 1),
			// Created by coalesced increments: the first (tx2) wins.
			row("usda", "3", 1_230_195, 2),
			row("usdc", "6", 1_230_196, 4),
			row("wkiki", "9", 1_230_195, 1),
			// Deleted by tx2, re-created by tx3: a new row.
			row("wstx", "3", 1_230_195, 3),
		]);
	});
});
