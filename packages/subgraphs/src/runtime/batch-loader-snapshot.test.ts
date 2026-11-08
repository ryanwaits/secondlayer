import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely, KyselyPlugin } from "kysely";
import { loadBlockRange } from "./batch-loader.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const H = 7_500_000;
let db: Kysely<Database>;

async function clean() {
	await db.deleteFrom("events").where("block_height", "=", H).execute();
	await db.deleteFrom("transactions").where("block_height", "=", H).execute();
	await db.deleteFrom("blocks").where("height", "=", H).execute();
}

beforeAll(async () => {
	db = getDb();
	await clean();
	await db
		.insertInto("blocks")
		.values({
			height: H,
			hash: "0xsnapshot",
			parent_hash: "0xparent",
			burn_block_height: H,
			burn_block_hash: null,
			timestamp: 1_700_000_000,
			canonical: true,
		})
		.execute();
	await sql`
		INSERT INTO transactions (tx_id, block_height, tx_index, type, sender, status, raw_tx)
		VALUES ('0xsnaptx', ${H}, 0, 'token_transfer', 'SP1', 'success', '0x00')
	`.execute(db);
});

afterAll(clean);

describe("a block range is read from one snapshot", () => {
	it("opens one repeatable-read transaction and reads nothing outside it", async () => {
		const direct: string[] = [];
		let transactions = 0;
		const spy = new Proxy(db, {
			get(target, prop, receiver) {
				if (prop === "selectFrom") {
					return (...args: unknown[]) => {
						direct.push(String(args[0]));
						return (target.selectFrom as (...a: unknown[]) => unknown)(...args);
					};
				}
				if (prop === "transaction") {
					return () => {
						transactions++;
						return target.transaction();
					};
				}
				return Reflect.get(target, prop, receiver);
			},
		});

		const range = await loadBlockRange(spy, H, H);

		expect(transactions).toBe(1);
		expect(direct).toEqual([]);
		expect(range.get(H)?.txs.length).toBe(1);
	});

	it("a reorg committing mid-load cannot split the block from its transactions", async () => {
		// After the blocks read returns, a second connection commits a reorg that
		// orphans the block and drops its transactions.
		let fired = false;
		const reorgAfterBlocks: KyselyPlugin = {
			transformQuery: ({ node }) => node,
			async transformResult({ result }) {
				if (!fired && result.rows.some((r) => r.hash === "0xsnapshot")) {
					fired = true;
					await sql`UPDATE blocks SET canonical = false WHERE height = ${H}`.execute(
						getDb(),
					);
					await sql`DELETE FROM transactions WHERE block_height = ${H}`.execute(
						getDb(),
					);
				}
				return result;
			},
		};

		const range = await loadBlockRange(db.withPlugin(reorgAfterBlocks), H, H);

		const data = range.get(H);
		// All of the pre-reorg block, or none of it: never the block without its txs.
		expect(data === undefined || data.txs.length === 1).toBe(true);
		expect(fired).toBe(true);
	});
});
