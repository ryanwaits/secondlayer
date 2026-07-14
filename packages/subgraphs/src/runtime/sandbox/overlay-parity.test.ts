import { afterAll, describe, expect, test } from "bun:test";
// f071 Stage 2a — Step 3's load-bearing correctness gate: the worker-side
// `WorkerCtx` overlay must be IDENTICAL to the real `SubgraphContext`
// overlay (`context.ts`'s `overlayOne`/`overlayMany`/`applyOpToRow`) for the
// same sequence of writes and reads. Any divergence here is exactly the
// silent read-your-writes bug the plan's STOP conditions call out as
// unacceptable to paper over.
//
// Methodology: drive the SAME write sequence through (a) a real
// `SubgraphContext` (the oracle) and (b) a `WorkerCtx` whose `sendRead`
// answers via a SECOND real `SubgraphContext` instance whose own ops array
// is always empty — exactly what `host.ts` does in production (an
// always-empty-ops ctx's `findOne`/`findMany` IS a raw base-DB read, since
// `overlayOne`/`overlayMany` short-circuit to the DB row unchanged when
// `ops.length === 0`). Both then read through their respective ctx and the
// results must match, field for field.
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { SubgraphSchema } from "../../types.ts";
import { type BlockMeta, SubgraphContext, type TxMeta } from "../context.ts";
import type { ReadReply } from "./protocol.ts";
import { WorkerCtx } from "./worker-ctx.ts";

const SKIP = !process.env.DATABASE_URL;
const SCHEMA = `sg_overlay_parity_${randomUUID().slice(0, 8)}`;

const SUBGRAPH_SCHEMA: SubgraphSchema = {
	transfers: {
		columns: {
			sender: { type: "principal" },
			recipient: { type: "principal" },
			amount: { type: "uint" },
		},
	},
	balances: {
		columns: {
			address: { type: "principal" },
			balance: { type: "uint" },
			label: { type: "text", nullable: true },
		},
		uniqueKeys: [["address"]],
	},
};

const BLOCK: BlockMeta = {
	height: 1000,
	hash: "0xblock",
	timestamp: 0,
	burnBlockHeight: 0,
};
const TX: TxMeta = {
	txId: "0xtx1",
	sender: "SPSENDER",
	type: "contract_call",
	status: "success",
};

function realCtx(): SubgraphContext {
	return new SubgraphContext(
		getDb(),
		SCHEMA,
		SUBGRAPH_SCHEMA,
		BLOCK,
		TX,
		false,
		false,
	);
}

/** Answers a WorkerCtx's reads via a second, always-empty-ops real
 *  SubgraphContext — the same mechanism `host.ts` uses in production. */
function hostAnswerSendRead() {
	const hostCtx = realCtx(); // ops never mutated — pure raw-read oracle
	return async (
		method:
			| "findOne"
			| "findMany"
			| "count"
			| "sum"
			| "min"
			| "max"
			| "countDistinct",
		table: string,
		where: Record<string, unknown>,
		column?: string,
	): Promise<ReadReply> => {
		switch (method) {
			case "findOne":
				return { kind: "row", row: await hostCtx.findOne(table, where) };
			case "findMany":
				return { kind: "rows", rows: await hostCtx.findMany(table, where) };
			case "count":
				return { kind: "count", count: await hostCtx.count(table, where) };
			case "countDistinct":
				return {
					kind: "count",
					// biome-ignore lint/style/noNonNullAssertion: column always provided for this method
					count: await hostCtx.countDistinct(table, column!, where),
				};
			case "sum": {
				// biome-ignore lint/style/noNonNullAssertion: column always provided for this method
				const v = await hostCtx.sum(table, column!, where);
				return { kind: "amount", amount: v.toString() };
			}
			case "min": {
				// biome-ignore lint/style/noNonNullAssertion: column always provided for this method
				const v = await hostCtx.min(table, column!, where);
				return { kind: "amount", amount: v == null ? null : v.toString() };
			}
			case "max": {
				// biome-ignore lint/style/noNonNullAssertion: column always provided for this method
				const v = await hostCtx.max(table, column!, where);
				return { kind: "amount", amount: v == null ? null : v.toString() };
			}
		}
	};
}

function workerCtx(): WorkerCtx {
	return new WorkerCtx(BLOCK, SUBGRAPH_SCHEMA, TX, hostAnswerSendRead());
}

describe.skipIf(SKIP)(
	"sandbox overlay parity — WorkerCtx vs real SubgraphContext",
	() => {
		const db = getDb();
		let didSetup = false;

		afterAll(async () => {
			if (didSetup) {
				await sql.raw(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`).execute(db);
			}
		});

		async function setup(): Promise<void> {
			if (didSetup) return;
			didSetup = true;
			await sql.raw(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`).execute(db);
			await sql
				.raw(
					`CREATE TABLE IF NOT EXISTS "${SCHEMA}"."transfers" (
					_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					sender text, recipient text, amount numeric,
					_block_height bigint, _tx_id text, _created_at timestamptz DEFAULT NOW()
				)`,
				)
				.execute(db);
			await sql
				.raw(
					`CREATE TABLE IF NOT EXISTS "${SCHEMA}"."balances" (
					_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
					address text, balance numeric, label text,
					_block_height bigint, _tx_id text, _created_at timestamptz DEFAULT NOW(),
					CONSTRAINT uq_overlay_parity_address UNIQUE (address)
				)`,
				)
				.execute(db);
		}

		test("plain insert then findOne — matches with no base row", async () => {
			await setup();
			const oracle = realCtx();
			oracle.insert("transfers", {
				sender: "SP1",
				recipient: "SP2",
				amount: 500n,
			});
			const oracleRow = await oracle.findOne("transfers", { sender: "SP1" });

			const worker = workerCtx();
			worker.insert("transfers", {
				sender: "SP1",
				recipient: "SP2",
				amount: 500n,
			});
			const workerRow = await worker.findOne("transfers", { sender: "SP1" });

			expect(workerRow).not.toBeNull();
			expect(workerRow?.sender).toBe(oracleRow?.sender);
			expect(workerRow?.recipient).toBe(oracleRow?.recipient);
			expect(workerRow?.amount).toBe(oracleRow?.amount);
		});

		test("upsert onto an existing base row — overlay merges non-key columns", async () => {
			await setup();
			await sql
				.raw(
					`INSERT INTO "${SCHEMA}"."balances" (address, balance, label, _block_height, _tx_id) VALUES ('SP_EXIST', 100, 'orig', 1, '0xseed')`,
				)
				.execute(db);

			const oracle = realCtx();
			oracle.upsert(
				"balances",
				{ address: "SP_EXIST" },
				{ balance: 999n, label: "updated" },
			);
			const oracleRow = await oracle.findOne("balances", {
				address: "SP_EXIST",
			});

			const worker = workerCtx();
			worker.upsert(
				"balances",
				{ address: "SP_EXIST" },
				{ balance: 999n, label: "updated" },
			);
			const workerRow = await worker.findOne("balances", {
				address: "SP_EXIST",
			});

			expect(workerRow).toEqual(oracleRow as Record<string, unknown>);
			expect(workerRow?.balance).toBe(999n);
			expect(workerRow?.label).toBe("updated");
		});

		test("upsert with no base row — overlay synthesizes the row", async () => {
			await setup();
			const oracle = realCtx();
			oracle.upsert(
				"balances",
				{ address: "SP_NEW" },
				{ balance: 42n, label: "fresh" },
			);
			const oracleRow = await oracle.findOne("balances", { address: "SP_NEW" });

			const worker = workerCtx();
			worker.upsert(
				"balances",
				{ address: "SP_NEW" },
				{ balance: 42n, label: "fresh" },
			);
			const workerRow = await worker.findOne("balances", { address: "SP_NEW" });

			expect(workerRow).toEqual(oracleRow as Record<string, unknown>);
			expect(workerRow?.balance).toBe(42n);
		});

		test("increment onto an existing base row — overlay adds the delta", async () => {
			await setup();
			await sql
				.raw(
					`INSERT INTO "${SCHEMA}"."balances" (address, balance, _block_height, _tx_id) VALUES ('SP_INC', 1000, 1, '0xseed')`,
				)
				.execute(db);

			const oracle = realCtx();
			oracle.increment("balances", { address: "SP_INC" }, { balance: 250n });
			const oracleRow = await oracle.findOne("balances", { address: "SP_INC" });

			const worker = workerCtx();
			worker.increment("balances", { address: "SP_INC" }, { balance: 250n });
			const workerRow = await worker.findOne("balances", { address: "SP_INC" });

			expect(workerRow?.balance).toBe(oracleRow?.balance);
			expect(workerRow?.balance).toBe(1250n);
		});

		test("increment with no base row — overlay synthesizes the row from the delta", async () => {
			await setup();
			const oracle = realCtx();
			oracle.increment("balances", { address: "SP_INC_NEW" }, { balance: 77n });
			const oracleRow = await oracle.findOne("balances", {
				address: "SP_INC_NEW",
			});

			const worker = workerCtx();
			worker.increment("balances", { address: "SP_INC_NEW" }, { balance: 77n });
			const workerRow = await worker.findOne("balances", {
				address: "SP_INC_NEW",
			});

			expect(workerRow?.balance).toBe(oracleRow?.balance);
			expect(workerRow?.balance).toBe(77n);
		});

		test("update onto an existing base row — overlay applies the SET", async () => {
			await setup();
			await sql
				.raw(
					`INSERT INTO "${SCHEMA}"."balances" (address, balance, label, _block_height, _tx_id) VALUES ('SP_UPD', 5, 'a', 1, '0xseed')`,
				)
				.execute(db);

			const oracle = realCtx();
			oracle.update("balances", { address: "SP_UPD" }, { label: "b" });
			const oracleRow = await oracle.findOne("balances", { address: "SP_UPD" });

			const worker = workerCtx();
			worker.update("balances", { address: "SP_UPD" }, { label: "b" });
			const workerRow = await worker.findOne("balances", { address: "SP_UPD" });

			expect(workerRow?.label).toBe(oracleRow?.label);
			expect(workerRow?.label).toBe("b");
			expect(workerRow?.balance).toBe(oracleRow?.balance);
		});

		test("delete — overlay hides the row from findOne", async () => {
			await setup();
			await sql
				.raw(
					`INSERT INTO "${SCHEMA}"."balances" (address, balance, _block_height, _tx_id) VALUES ('SP_DEL', 9, 1, '0xseed')`,
				)
				.execute(db);

			const oracle = realCtx();
			oracle.delete("balances", { address: "SP_DEL" });
			const oracleRow = await oracle.findOne("balances", { address: "SP_DEL" });

			const worker = workerCtx();
			worker.delete("balances", { address: "SP_DEL" });
			const workerRow = await worker.findOne("balances", { address: "SP_DEL" });

			expect(oracleRow).toBeNull();
			expect(workerRow).toBeNull();
		});

		test("a chain of ops on the same key (insert → increment → update → increment) — overlay applies them in order", async () => {
			await setup();
			const oracle = realCtx();
			oracle.upsert(
				"balances",
				{ address: "SP_CHAIN" },
				{ balance: 10n, label: "l0" },
			);
			oracle.increment("balances", { address: "SP_CHAIN" }, { balance: 5n });
			oracle.update("balances", { address: "SP_CHAIN" }, { label: "l1" });
			oracle.increment("balances", { address: "SP_CHAIN" }, { balance: 100n });
			const oracleRow = await oracle.findOne("balances", {
				address: "SP_CHAIN",
			});

			const worker = workerCtx();
			worker.upsert(
				"balances",
				{ address: "SP_CHAIN" },
				{ balance: 10n, label: "l0" },
			);
			worker.increment("balances", { address: "SP_CHAIN" }, { balance: 5n });
			worker.update("balances", { address: "SP_CHAIN" }, { label: "l1" });
			worker.increment("balances", { address: "SP_CHAIN" }, { balance: 100n });
			const workerRow = await worker.findOne("balances", {
				address: "SP_CHAIN",
			});

			expect(workerRow?.balance).toBe(oracleRow?.balance);
			expect(workerRow?.balance).toBe(115n);
			expect(workerRow?.label).toBe(oracleRow?.label);
			expect(workerRow?.label).toBe("l1");
		});

		test("findMany over several rows with a mix of base + overlaid state", async () => {
			await setup();
			await sql
				.raw(
					`INSERT INTO "${SCHEMA}"."balances" (address, balance, label, _block_height, _tx_id) VALUES
					('SP_FM_1', 1, 'g', 1, '0xseed'),
					('SP_FM_2', 2, 'g', 1, '0xseed'),
					('SP_FM_3', 3, 'g', 1, '0xseed')`,
				)
				.execute(db);

			const oracle = realCtx();
			oracle.increment("balances", { address: "SP_FM_1" }, { balance: 10n }); // 1 -> 11
			oracle.delete("balances", { address: "SP_FM_2" }); // removed
			oracle.upsert(
				"balances",
				{ address: "SP_FM_4" },
				{ balance: 40n, label: "g" },
			); // new
			const oracleRows = await oracle.findMany("balances", { label: "g" });

			const worker = workerCtx();
			worker.increment("balances", { address: "SP_FM_1" }, { balance: 10n });
			worker.delete("balances", { address: "SP_FM_2" });
			worker.upsert(
				"balances",
				{ address: "SP_FM_4" },
				{ balance: 40n, label: "g" },
			);
			const workerRows = await worker.findMany("balances", { label: "g" });

			const byAddress = (rows: Record<string, unknown>[]) => {
				const m = new Map<string, unknown>();
				for (const r of rows) m.set(String(r.address), r.balance);
				return m;
			};
			expect(byAddress(workerRows)).toEqual(byAddress(oracleRows));
			expect(byAddress(workerRows).get("SP_FM_1")).toBe(11n);
			expect(byAddress(workerRows).has("SP_FM_2")).toBe(false);
			expect(byAddress(workerRows).get("SP_FM_3")).toBe(3n);
			expect(byAddress(workerRows).get("SP_FM_4")).toBe(40n);
		});

		test("checkpoint/rollback discards overlaid ops for both read and write visibility", async () => {
			await setup();
			const oracle = realCtx();
			oracle.upsert(
				"balances",
				{ address: "SP_RB" },
				{ balance: 1n, label: "keep" },
			);
			const oracleCheckpoint = oracle.opsCheckpoint();
			oracle.increment("balances", { address: "SP_RB" }, { balance: 999n });
			oracle.rollbackTo(oracleCheckpoint);
			const oracleRow = await oracle.findOne("balances", { address: "SP_RB" });

			const worker = workerCtx();
			worker.upsert(
				"balances",
				{ address: "SP_RB" },
				{ balance: 1n, label: "keep" },
			);
			const workerCheckpoint = worker.opsCheckpoint();
			worker.increment("balances", { address: "SP_RB" }, { balance: 999n });
			worker.rollbackTo(workerCheckpoint);
			const workerRow = await worker.findOne("balances", { address: "SP_RB" });

			expect(workerRow?.balance).toBe(oracleRow?.balance);
			expect(workerRow?.balance).toBe(1n);
			expect(worker.pendingOps.length).toBe(1);
		});

		test("increment without a matching uniqueKeys constraint throws identically", () => {
			const oracle = realCtx();
			const worker = workerCtx();
			expect(() =>
				oracle.increment("transfers", { sender: "SP1" }, { amount: 1n }),
			).toThrow(/requires a uniqueKeys constraint/);
			expect(() =>
				worker.increment("transfers", { sender: "SP1" }, { amount: 1n }),
			).toThrow(/requires a uniqueKeys constraint/);
		});
	},
);
