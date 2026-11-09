import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { up } from "../migrations/0210_mempool_evict_superseded_nonces.ts";

const HAS_DB = !!process.env.DATABASE_URL;

// A real mainnet token transfer; the origin nonce sits at hex 54..70.
const RAW_TX =
	"0x00000000010400f2bba6df751755ab9ac1df8b387d981cfe265cdf000000000023b83c00000000000000b4000105c7d1e497ff1e980f6504947cd9f079f793041009c69179357883ec13c2b7661e541151591a4ededf6b0801d1a01ee32333420459d6029788001ceded4c5164030200000000000516fbd9a1702f4ecc44fc01f1894c72fcbb23a53ce8000000000000000100000000000000000000000000000000000000000000000000000000000000000000";

function withNonce(nonce: number): string {
	const hex = RAW_TX.slice(2);
	return `0x${hex.slice(0, 54)}${nonce.toString(16).padStart(16, "0")}${hex.slice(70)}`;
}

describe.skipIf(!HAS_DB)(
	"0210_mempool_evict_superseded_nonces migration",
	() => {
		test("deletes pending txs at or below a nonce their sender confirmed, keeps the rest", async () => {
			if (!process.env.DATABASE_URL) throw new Error("missing DATABASE_URL");
			const schema = `migration_0210_${Date.now().toString(36)}`;
			const client = postgres(process.env.DATABASE_URL, { max: 1 });
			const db = new Kysely<unknown>({
				dialect: new PostgresJSDialect({ postgres: client }),
			});
			try {
				await sql`CREATE SCHEMA ${sql.ref(schema)}`.execute(db);
				await sql`SET search_path TO ${sql.ref(schema)}`.execute(db);
				await sql`CREATE TABLE blocks (height BIGINT PRIMARY KEY, timestamp BIGINT NOT NULL, canonical BOOLEAN NOT NULL)`.execute(
					db,
				);
				await sql`CREATE TABLE transactions (tx_id TEXT PRIMARY KEY, block_height BIGINT, tx_index INT, sender TEXT, raw_tx TEXT)`.execute(
					db,
				);
				await sql`CREATE TABLE mempool_transactions (tx_id TEXT PRIMARY KEY, sender TEXT, raw_tx TEXT, received_at TIMESTAMPTZ NOT NULL DEFAULT now())`.execute(
					db,
				);
				const now = Math.floor(Date.now() / 1000);
				await sql`
				INSERT INTO blocks VALUES
					(1, ${now - 7200}, true),
					(2, ${now}, true),
					(3, ${now}, false)
			`.execute(db);
				// SPA's nonce 10 confirmed; nonce 20 only on an orphaned block; SPB's
				// last confirmed tx predates every pending receipt.
				await sql`
				INSERT INTO transactions VALUES
					('0xold', 1, 0, 'SPB', ${withNonce(50)}),
					('0xa10', 2, 0, 'SPA', ${withNonce(10)}),
					('0xa20', 3, 0, 'SPA', ${withNonce(20)}),
					('0xburn', 2, 1, 'SPA', '0x00')
			`.execute(db);
				await sql`
				INSERT INTO mempool_transactions (tx_id, sender, raw_tx) VALUES
					('0xm9', 'SPA', ${withNonce(9)}),
					('0xm10', 'SPA', ${withNonce(10)}),
					('0xm11', 'SPA', ${withNonce(11)}),
					('0xmb', 'SPB', ${withNonce(5)})
			`.execute(db);

				await up(db);

				const { rows } = await sql<{ tx_id: string }>`
				SELECT tx_id FROM mempool_transactions ORDER BY tx_id
			`.execute(db);
				expect(rows.map((r) => r.tx_id)).toEqual(["0xm11", "0xmb"]);
			} finally {
				await sql`DROP SCHEMA IF EXISTS ${sql.ref(schema)} CASCADE`.execute(db);
				await db.destroy();
			}
		});
	},
);
