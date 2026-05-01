import { beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import type { SubgraphSchema } from "../types.ts";
import { SubgraphContext } from "./context.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5435/secondlayer";

const schema = {
	transfers: {
		columns: {
			sender: { type: "string" },
			recipient: { type: "string" },
			amount: { type: "uint" },
		},
	},
} as unknown as SubgraphSchema;

let db: Kysely<Database>;
let pgSchemaName: string;

beforeAll(async () => {
	db = getDb();
	pgSchemaName = `sg_ctx_test_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
	await sql.raw(`CREATE SCHEMA IF NOT EXISTS "${pgSchemaName}"`).execute(db);
	await sql
		.raw(
			`CREATE TABLE "${pgSchemaName}"."transfers" (
				sender TEXT NOT NULL,
				recipient TEXT NOT NULL,
				amount NUMERIC(78, 0) NOT NULL,
				_block_height BIGINT NOT NULL,
				_tx_id TEXT NOT NULL,
				_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)`,
		)
		.execute(db);
});

describe("SubgraphContext flush manifest", () => {
	it("returns FlushManifest describing each write", async () => {
		const ctx = new SubgraphContext(
			db,
			pgSchemaName,
			schema,
			{
				height: 1000,
				hash: "0xabc",
				timestamp: 1700000000,
				burnBlockHeight: 900,
			},
			{
				txId: "0xdeadbeef",
				sender: "SP1",
				type: "contract_call",
				status: "success",
			},
		);

		ctx.insert("transfers", {
			sender: "SP1",
			recipient: "SP2",
			amount: 100n,
		});
		ctx.insert("transfers", {
			sender: "SP2",
			recipient: "SP3",
			amount: 200n,
		});
		ctx.insert("transfers", {
			sender: "SP3",
			recipient: "SP1",
			amount: 300n,
		});

		const manifest = await ctx.flush();
		expect(manifest.count).toBe(3);
		expect(manifest.writes).toHaveLength(3);

		for (let i = 0; i < 3; i++) {
			// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
			const w = manifest.writes[i]!;
			expect(w.op).toBe("insert");
			expect(w.table).toBe("transfers");
			expect(w.pk.blockHeight).toBe(1000);
			expect(w.pk.txId).toBe("0xdeadbeef");
			expect(w.pk.rowIndex).toBe(i);
			// Bigint amounts should be stringified for JSON safety
			expect(typeof w.row.amount).toBe("string");
		}

		expect(manifest.writes[0].row.sender).toBe("SP1");
		expect(manifest.writes[2].row.recipient).toBe("SP1");
	});
});
