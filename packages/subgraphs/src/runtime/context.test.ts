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
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const schema = {
	transfers: {
		columns: {
			sender: { type: "string" },
			recipient: { type: "string" },
			amount: { type: "uint" },
		},
	},
	balances: {
		columns: {
			address: { type: "principal", indexed: true },
			balance: { type: "uint" },
		},
		uniqueKeys: [["address"]],
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
	await sql
		.raw(
			`CREATE TABLE "${pgSchemaName}"."balances" (
				address TEXT NOT NULL,
				balance NUMERIC(78, 0),
				_block_height BIGINT NOT NULL,
				_tx_id TEXT NOT NULL,
				_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				UNIQUE (address)
			)`,
		)
		.execute(db);
});

function makeCtx(height = 1000): SubgraphContext {
	return new SubgraphContext(
		db,
		pgSchemaName,
		schema,
		{ height, hash: "0xabc", timestamp: 1700000000, burnBlockHeight: 900 },
		{
			txId: "0xdeadbeef",
			sender: "SP1",
			type: "contract_call",
			status: "success",
		},
	);
}

async function readBalance(address: string): Promise<bigint | null> {
	const { rows } = await sql
		.raw(
			`SELECT balance FROM "${pgSchemaName}"."balances" WHERE address = '${address}'`,
		)
		.execute(db);
	const row = (rows as { balance: string }[])[0];
	return row ? BigInt(row.balance) : null;
}

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

describe("reads observe writes queued earlier in the same block", () => {
	it("findOne sees a pending upsert queued earlier in the block", async () => {
		const ctx = makeCtx();
		const addr = `SPOVERLAY1_${Date.now()}`;
		ctx.upsert("balances", { address: addr }, { balance: 100n });

		const row = await ctx.findOne("balances", { address: addr });
		expect(row).not.toBeNull();
		expect(BigInt(String(row?.balance))).toBe(100n);
	});

	it("patchOrInsert functional updaters compose within a block", async () => {
		const ctx = makeCtx();
		const addr = `SPOVERLAY2_${Date.now()}`;
		const toBig = (v: unknown) => BigInt(String(v ?? 0));

		await ctx.patchOrInsert(
			"balances",
			{ address: addr },
			{ address: addr, balance: (e) => toBig(e?.balance) + 500n },
		);
		await ctx.patchOrInsert(
			"balances",
			{ address: addr },
			{ address: addr, balance: (e) => toBig(e?.balance) - 200n },
		);
		await ctx.patchOrInsert(
			"balances",
			{ address: addr },
			{ address: addr, balance: (e) => toBig(e?.balance) - 300n },
		);
		await ctx.flush();

		expect(await readBalance(addr)).toBe(0n);
	});

	it("overlay composes with committed DB state across blocks", async () => {
		const addr = `SPOVERLAY3_${Date.now()}`;
		const toBig = (v: unknown) => BigInt(String(v ?? 0));

		const ctx1 = makeCtx(1000);
		await ctx1.patchOrInsert(
			"balances",
			{ address: addr },
			{ address: addr, balance: (e) => toBig(e?.balance) + 70n },
		);
		await ctx1.flush();

		const ctx2 = makeCtx(1001);
		await ctx2.patchOrInsert(
			"balances",
			{ address: addr },
			{ address: addr, balance: (e) => toBig(e?.balance) + 30n },
		);
		const pending = await ctx2.findOne("balances", { address: addr });
		expect(BigInt(String(pending?.balance))).toBe(100n);
		await ctx2.flush();

		expect(await readBalance(addr)).toBe(100n);
	});

	it("findOne sees pending update and delete ops", async () => {
		const ctx = makeCtx();
		const addr = `SPOVERLAY4_${Date.now()}`;
		ctx.upsert("balances", { address: addr }, { balance: 10n });
		ctx.update("balances", { address: addr }, { balance: 25n });

		const updated = await ctx.findOne("balances", { address: addr });
		expect(BigInt(String(updated?.balance))).toBe(25n);

		ctx.delete("balances", { address: addr });
		expect(await ctx.findOne("balances", { address: addr })).toBeNull();
	});

	it("findMany overlays pending writes onto DB rows", async () => {
		const ctx = makeCtx();
		const a = `SPMANY_A_${Date.now()}`;
		const b = `SPMANY_B_${Date.now()}`;
		ctx.upsert("balances", { address: a }, { balance: 1n });
		ctx.upsert("balances", { address: b }, { balance: 2n });
		ctx.increment("balances", { address: a }, { balance: 10n });

		const rows = await ctx.findMany("balances", { address: a });
		expect(rows).toHaveLength(1);
		expect(BigInt(String(rows[0]?.balance))).toBe(11n);
	});
});

describe("increment applies atomic insert-or-add deltas", () => {
	it("insert-or-add semantics, negative deltas, same-key coalescing", async () => {
		const addr = `SPINC1_${Date.now()}`;
		const ctx = makeCtx();
		ctx.increment("balances", { address: addr }, { balance: 501200n });
		ctx.increment("balances", { address: addr }, { balance: -501200n });
		ctx.increment("balances", { address: addr }, { balance: 7n });
		await ctx.flush();
		expect(await readBalance(addr)).toBe(7n);
	});

	it("adds to committed state atomically across blocks", async () => {
		const addr = `SPINC2_${Date.now()}`;
		const ctx1 = makeCtx(1000);
		ctx1.increment("balances", { address: addr }, { balance: 100n });
		await ctx1.flush();

		const ctx2 = makeCtx(1001);
		ctx2.increment("balances", { address: addr }, { balance: -40n });
		await ctx2.flush();
		expect(await readBalance(addr)).toBe(60n);
	});

	it("findOne overlays pending increments", async () => {
		const addr = `SPINC3_${Date.now()}`;
		const ctx = makeCtx();
		ctx.increment("balances", { address: addr }, { balance: 5n });
		const row = await ctx.findOne("balances", { address: addr });
		expect(BigInt(String(row?.balance))).toBe(5n);
	});

	it("rejects keys without a matching uniqueKeys constraint", () => {
		const ctx = makeCtx();
		expect(() =>
			ctx.increment("transfers", { sender: "SP1" }, { amount: 1n }),
		).toThrow(/uniqueKeys/);
	});

	it("rejects non-numeric deltas and key-column deltas", () => {
		const ctx = makeCtx();
		expect(() =>
			ctx.increment(
				"balances",
				{ address: "SP1" },
				// biome-ignore lint/suspicious/noExplicitAny: intentional bad input
				{ balance: "10" as any },
			),
		).toThrow(/bigint or number/);
		expect(() =>
			ctx.increment("balances", { address: "SP1" }, { address: 1n }),
		).toThrow(/key column/);
	});
});

describe("a handler that throws leaves no partial writes", () => {
	it("rollbackTo discards ops queued after the checkpoint", async () => {
		const addr = `SPRB1_${Date.now()}`;
		const ctx = makeCtx();
		ctx.increment("balances", { address: addr }, { balance: 100n });

		const cp = ctx.opsCheckpoint();
		ctx.increment("balances", { address: addr }, { balance: -999n });
		ctx.insert("transfers", {
			sender: "SP1",
			recipient: "SP2",
			amount: 1n,
		});
		ctx.rollbackTo(cp);

		expect(ctx.pendingOps).toBe(1);
		await ctx.flush();
		expect(await readBalance(addr)).toBe(100n);
	});
});
