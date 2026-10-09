import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database, Transaction } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { applyBlock, matchBlock } from "../src/runtime/apply-block.ts";
import type { RuntimeEvent } from "../src/runtime/batch-loader.ts";
import {
	type PreloadedBlockData,
	processBlock,
} from "../src/runtime/block-processor.ts";
import type { SubgraphContext } from "../src/runtime/context.ts";
import {
	MemoryStore,
	MemorySubgraphContext,
} from "../src/runtime/memory-store.ts";
import { generateSubgraphSQL } from "../src/schema/generator.ts";
import type { SubgraphDefinition, SubgraphSchema } from "../src/types.ts";

/**
 * The pure block core and the Postgres path must write the same rows: replay
 * recomputes a served subgraph in memory, so any gap between the memory model
 * and the flush would read as tampering.
 */

const POOL = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-vault-v2-01";

const uintHex = (n: bigint) => `0x01${n.toString(16).padStart(32, "0")}`;

const schema = {
	reserves: {
		columns: { token: { type: "text" }, amount: { type: "uint" } },
		uniqueKeys: [["token"]],
	},
	stats: {
		columns: {
			id: { type: "text" },
			writes: { type: "uint" },
			last: { type: "uint", nullable: true },
		},
		uniqueKeys: [["id"]],
	},
	log: {
		columns: {
			value: { type: "int" },
			seen: { type: "boolean" },
			meta: { type: "jsonb" },
			at: { type: "timestamp" },
		},
	},
} as unknown as SubgraphSchema;

type Ctx = SubgraphContext;
type MapEvent = { key: bigint; value: bigint };

const def = {
	name: `apply-block-${randomUUID().slice(0, 8)}`,
	sources: {
		reserve: { type: "map_set", contractId: POOL, map: "reserve" },
		drop: { type: "map_delete", contractId: POOL, map: "reserve" },
		counter: { type: "var_set", contractId: POOL, varName: "counter" },
	},
	schema,
	handlers: {
		reserve: async (e: MapEvent, ctx: Ctx) => {
			const token = String(e.key);
			const prev = await ctx.findOne("reserves", { token });
			ctx.upsert("reserves", { token }, { amount: e.value });
			ctx.increment("stats", { id: "writes" }, { writes: 1n });
			if (prev) {
				ctx.upsert(
					"stats",
					{ id: `prev-${token}` },
					{ writes: 0n, last: prev.amount as bigint },
				);
			}
		},
		drop: async (e: { key: bigint }, ctx: Ctx) => {
			ctx.delete("reserves", { token: String(e.key) });
			ctx.update("stats", { id: "writes" }, { last: 0n });
		},
		counter: (e: { value: bigint }, ctx: Ctx) => {
			ctx.insert("log", {
				value: e.value,
				seen: e.value % 2n === 0n,
				meta: { b: [1, { z: "x", a: e.value.toString() }], a: null },
				at: "2024-01-02T03:04:05.000Z",
			});
		},
	},
} as unknown as SubgraphDefinition;

let txSeq = 0;
function tx(height: number, index: number): Transaction {
	txSeq++;
	return {
		tx_id: `0x${height.toString(16)}${String(txSeq).padStart(4, "0")}`,
		block_height: height,
		tx_index: index,
		type: "contract_call",
		sender: "SP000000000000000000002Q6VF78",
		status: "success",
		contract_id: POOL,
		function_name: "swap",
		function_args: null,
		raw_result: null,
		raw_tx: "0x00",
		created_at: new Date(0),
	};
}

type Write =
	| { kind: "set"; key: bigint; value: bigint }
	| { kind: "delete"; key: bigint }
	| { kind: "var"; value: bigint };

/** A block with one tx per entry of `perTx`; writes ordered within the block. */
function block(height: number, perTx: Write[][]): PreloadedBlockData {
	const txs = perTx.map((_, i) => tx(height, i));
	const vmEvents: RuntimeEvent[] = [];
	let ordinal = 0;
	perTx.forEach((writes, i) => {
		for (const w of writes) {
			const data =
				w.kind === "var"
					? {
							contract_identifier: POOL,
							var_name: "counter",
							raw_value: uintHex(w.value),
						}
					: {
							contract_identifier: POOL,
							map_name: "reserve",
							raw_key: uintHex(w.key),
							...(w.kind === "set" ? { raw_value: uintHex(w.value) } : {}),
						};
			vmEvents.push({
				id: `${txs[i]?.tx_id}#vm:${ordinal}`,
				tx_id: txs[i]?.tx_id as string,
				block_height: height,
				event_index: ordinal++,
				type:
					w.kind === "set"
						? "map_set"
						: w.kind === "delete"
							? "map_delete"
							: "var_set",
				data,
				created_at: new Date(0),
				clock: "vm",
			});
		}
	});
	return {
		block: {
			height,
			hash: `0x${"ab".repeat(31)}${height.toString(16).padStart(2, "0")}`,
			parent_hash: "0x00",
			burn_block_height: 900_000 + height,
			burn_block_hash: null,
			index_block_hash: `0x${"cd".repeat(31)}${height.toString(16).padStart(2, "0")}`,
			tx_count: txs.length,
			timestamp: 1_700_000_000 + height,
			canonical: true,
			created_at: new Date(0),
		},
		txs,
		events: [],
		vmEvents,
	};
}

const BLOCKS: PreloadedBlockData[] = [
	block(101, [
		[
			{ kind: "set", key: 1n, value: 100n },
			{ kind: "set", key: 2n, value: 7n },
		],
		[{ kind: "var", value: 3n }],
	]),
	block(102, [
		[
			{ kind: "set", key: 1n, value: 150n },
			{ kind: "set", key: 1n, value: 120n },
		],
		[
			{ kind: "delete", key: 2n },
			{ kind: "var", value: 4n },
		],
	]),
	block(103, []),
	block(104, [
		[{ kind: "set", key: 2n, value: 9n }],
		[{ kind: "var", value: 4n }],
	]),
	// A new key written by two txs in one block, and a delete then a re-insert
	// in one block: the cases where the stores could disagree on row meta.
	block(105, [
		[{ kind: "set", key: 5n, value: 50n }],
		[
			{ kind: "set", key: 5n, value: 51n },
			{ kind: "delete", key: 1n },
		],
		[{ kind: "set", key: 1n, value: 1n }],
	]),
];

/**
 * Order-free, type-free row form: what both stores must agree on. `_tx_id`
 * is left out: it is transaction attribution, unproven for state subgraphs,
 * and the Postgres flush keeps the LAST same-block writer of a new key while
 * the memory store (like ON CONFLICT across blocks) keeps the FIRST.
 * `_block_height` stays: both keep the block of the row's first write.
 */
function normalize(rows: Record<string, unknown>[]): string[] {
	return rows
		.map((row) => {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(row).sort(([a], [b]) =>
				a.localeCompare(b),
			)) {
				if (k === "_id" || k === "_created_at" || k === "_tx_id") continue;
				out[k] =
					v instanceof Date
						? v.getTime()
						: k === "at" && typeof v === "string"
							? Date.parse(v)
							: typeof v === "bigint" || typeof v === "number"
								? String(v)
								: v;
			}
			return JSON.stringify(out, (_k, v) =>
				v && typeof v === "object" && !Array.isArray(v)
					? Object.fromEntries(
							Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
						)
					: v,
			);
		})
		.sort();
}

async function replayInMemory(): Promise<
	Map<string, Record<string, unknown>[]>
> {
	const store = new MemoryStore();
	for (const data of BLOCKS) {
		const ctx = new MemorySubgraphContext(
			store,
			def.schema,
			{
				height: data.block.height,
				hash: data.block.hash,
				timestamp: data.block.timestamp,
				burnBlockHeight: data.block.burn_block_height,
				indexBlockHash: data.block.index_block_hash,
			},
			{ txId: "", sender: "", type: "", status: "" },
		);
		await applyBlock(def, data, ctx);
		await ctx.commitOps();
	}
	return store.tables;
}

describe("pure block core", () => {
	test("matchBlock dispatches the block's writes to their sources", () => {
		const first = BLOCKS[0] as PreloadedBlockData;
		const matched = matchBlock(def, first);
		expect(matched.map((m) => [m.sourceName, m.events.length])).toEqual([
			["reserve", 2],
			["counter", 1],
		]);
	});

	test("an empty block matches nothing and runs no handler", async () => {
		const ctx = new MemorySubgraphContext(
			new MemoryStore(),
			def.schema,
			{ height: 103, hash: "0x", timestamp: 0, burnBlockHeight: 0 },
			{ txId: "", sender: "", type: "", status: "" },
		);
		expect(await applyBlock(def, BLOCKS[2] as PreloadedBlockData, ctx)).toEqual(
			{ matched: 0, processed: 0, errors: 0, delivered: 0 },
		);
	});
});

describe.skipIf(!process.env.DATABASE_URL)(
	"processBlock (Postgres) and applyBlock (memory) write the same rows",
	() => {
		let db: Kysely<Database>;
		const pgSchema = `sg_apply_${randomUUID().slice(0, 8)}`;

		beforeAll(async () => {
			db = getDb();
			for (const stmt of generateSubgraphSQL(def, pgSchema).statements) {
				await sql.raw(stmt).execute(db);
			}
			await db
				.insertInto("subgraphs")
				.values({
					name: def.name,
					status: "active",
					definition: def as unknown as Record<string, unknown>,
					schema_hash: "test",
					handler_path: "test",
					schema_name: pgSchema,
					account_id: randomUUID(),
				})
				.execute();
		});

		afterAll(async () => {
			await db.deleteFrom("subgraphs").where("name", "=", def.name).execute();
			await sql.raw(`DROP SCHEMA IF EXISTS "${pgSchema}" CASCADE`).execute(db);
		});

		test("every table matches after dropping _id and _created_at", async () => {
			for (const data of BLOCKS) {
				const result = await processBlock(def, def.name, data.block.height, {
					preloaded: data,
				});
				expect(result.errors).toBe(0);
			}
			const memory = await replayInMemory();
			for (const table of Object.keys(schema)) {
				const { rows } = await sql
					.raw(`SELECT * FROM "${pgSchema}"."${table}" ORDER BY "_id"`)
					.execute(db);
				const served = normalize(rows as Record<string, unknown>[]);
				expect(served.length).toBeGreaterThan(0);
				expect(normalize(memory.get(table) ?? [])).toEqual(served);
			}
		});
	},
);
