import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import { SubgraphContext } from "./context.ts";

const SKIP = !process.env.DATABASE_URL;
const SCHEMA = `sg_inc_check_${randomUUID().slice(0, 8)}`;

const SUBGRAPH_SCHEMA = {
	balances: {
		columns: {
			address: { type: "principal" },
			balance: { type: "uint" },
		},
		uniqueKeys: [["address"]],
	},
	// biome-ignore lint/suspicious/noExplicitAny: minimal schema for the harness
} as any;

function ctxAt(height: number) {
	return new SubgraphContext(
		getDb(),
		SCHEMA,
		SUBGRAPH_SCHEMA,
		{ height, hash: "0x0", time: 0 },
		// biome-ignore lint/suspicious/noExplicitAny: minimal tx meta
		{ tx_id: `0xtest${height}` } as any,
		false,
		false,
	);
}

describe.skipIf(SKIP)("increment vs CHECK constraint (prod halt repro)", () => {
	afterAll(async () => {
		await sql`DROP SCHEMA IF EXISTS ${sql.raw(`"${SCHEMA}"`)} CASCADE`.execute(
			getDb(),
		);
	});

	test("debit-to-zero on an existing row survives the uint CHECK", async () => {
		const db = getDb();
		await sql.raw(`CREATE SCHEMA "${SCHEMA}"`).execute(db);
		await sql
			.raw(
				`CREATE TABLE "${SCHEMA}"."balances" (
					_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					_block_height bigint, _tx_id text, _created_at timestamptz,
					address text, balance numeric NOT NULL DEFAULT 0 CHECK (balance >= 0),
					CONSTRAINT uq_inc_check_address UNIQUE (address)
				)`,
			)
			.execute(db);

		// credit 8039 (insert path)
		const c1 = ctxAt(100);
		c1.increment("balances", { address: "SPX" }, { balance: 8039n });
		await c1.flush();

		// THE prod failure shape: full debit against the existing row. The old
		// INSERT..ON CONFLICT form errored here — Postgres validates the
		// PROPOSED tuple (-8039) against the CHECK before arbitration.
		const c2 = ctxAt(101);
		c2.increment("balances", { address: "SPX" }, { balance: -8039n });
		await c2.flush();

		const rows = await sql
			.raw(`SELECT balance::text AS b FROM "${SCHEMA}"."balances"`)
			.execute(db);
		// biome-ignore lint/suspicious/noExplicitAny: raw row
		expect((rows.rows[0] as any).b).toBe("0");
	});

	test("genuine negative (debit with no prior row) still fails loudly", async () => {
		const c = ctxAt(102);
		c.increment("balances", { address: "SP_NOBODY" }, { balance: -5n });
		await expect(c.flush()).rejects.toThrow(/check constraint/i);
	});
});
