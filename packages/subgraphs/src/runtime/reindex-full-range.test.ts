import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { generateSubgraphSQL } from "../schema/generator.ts";
import type {
	SubgraphDefinition,
	SubgraphHandler,
	SubgraphSchema,
} from "../types.ts";
import type { SubgraphContext } from "./context.ts";
import {
	type ReindexOptions,
	reindexSubgraph,
	resumeReindex,
} from "./reindex.ts";

/**
 * f079 — the regression test for a silent, unrecoverable data loss.
 *
 * `reindexSubgraph` drops the subgraph's schema unconditionally and then walks
 * only its resolved range. When that range came from the caller, a narrow one
 * did not scope the work — it destroyed everything outside itself. Clearing a
 * one-block gap on the public sbtc-flows subgraph with
 * `reindex --from-block N --to-block N` emptied all three of its tables, and
 * the damage was invisible: status went back to `active`, the cursor reached
 * chain tip, no gap rows were filed, nothing errored. Only a row count against
 * an independent source showed the loss.
 *
 * These tests drive the real runtime against real seeded blocks. The proof is
 * the row heights: after any reindex the FULL seeded span must be present, not
 * a sub-range of it.
 */
process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const START = 3_000;
const TIP = 3_400;
/** Spread across the whole span so any sub-range walk is visible in the rows. */
const EVENT_HEIGHTS = [3_000, 3_100, 3_200, 3_300, 3_400];
const ASSET = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t::t";
const BLOCK_HASH_PREFIX = "0xf079full";
const TX_ID_PREFIX = "0xf079fulltx";

let db: Kysely<Database>;
let priorTip: number | null = null;
const createdSchemas: string[] = [];
const createdSubgraphNames: string[] = [];

const schema = {
	balances: {
		columns: {
			address: { type: "principal", indexed: true },
			balance: { type: "uint" },
		},
		uniqueKeys: [["address"]],
	},
} as unknown as SubgraphSchema;

/** One distinct row per event height, so row heights == walked heights. */
function makeDef(name: string): SubgraphDefinition {
	return {
		name,
		startBlock: START,
		sources: { mint: { type: "ft_mint", assetIdentifier: ASSET } },
		schema,
		handlers: {
			mint: (async (e: unknown, ctx: SubgraphContext) => {
				const ev = e as { recipient: string; amount: bigint };
				ctx.increment(
					"balances",
					{ address: ev.recipient },
					{ balance: ev.amount },
				);
			}) as unknown as SubgraphHandler,
		},
	} as unknown as SubgraphDefinition;
}

async function seedChain(): Promise<void> {
	const blocks = [];
	for (let h = START; h <= TIP; h++) {
		blocks.push({
			height: h,
			hash: `${BLOCK_HASH_PREFIX}${h}`,
			parent_hash: `${BLOCK_HASH_PREFIX}${h - 1}`,
			burn_block_height: h + 900_000,
			burn_block_hash: null,
			timestamp: 1_700_000_000 + h,
			canonical: true,
		});
	}
	for (let i = 0; i < blocks.length; i += 500) {
		await db
			.insertInto("blocks")
			.values(blocks.slice(i, i + 500))
			.onConflict((oc) => oc.column("height").doNothing())
			.execute();
	}

	for (const h of EVENT_HEIGHTS) {
		const txId = `${TX_ID_PREFIX}${h}`;
		await db
			.insertInto("transactions")
			.values({
				tx_id: txId,
				block_height: h,
				tx_index: 0,
				type: "contract_call",
				sender: `SPF079SENDER${h}`,
				status: "success",
				contract_id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.t",
				function_name: "mint",
				raw_tx: "0x00",
			} as never)
			.onConflict((oc) => oc.doNothing())
			.execute();
		await db
			.insertInto("events")
			.values({
				id: randomUUID(),
				tx_id: txId,
				block_height: h,
				event_index: 0,
				type: "ft_mint_event",
				data: {
					asset_identifier: ASSET,
					amount: "100",
					recipient: `SPF079HOLDER${h}`,
				},
			} as never)
			.onConflict((oc) => oc.doNothing())
			.execute();
	}
}

async function setTip(value: number): Promise<void> {
	const network = process.env.NETWORK ?? "mainnet";
	await db
		.insertInto("index_progress")
		.values({ network, highest_seen_block: value } as never)
		.onConflict((oc) =>
			oc.column("network").doUpdateSet({ highest_seen_block: value }),
		)
		.execute();
}

async function readTip(): Promise<number | null> {
	const row = await db
		.selectFrom("index_progress")
		.select("highest_seen_block")
		.where("network", "=", process.env.NETWORK ?? "mainnet")
		.executeTakeFirst();
	return row ? Number(row.highest_seen_block) : null;
}

async function registerSubgraph(
	def: SubgraphDefinition,
	pgSchema: string,
	overrides: Record<string, unknown> = {},
): Promise<void> {
	createdSubgraphNames.push(def.name);
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
			start_block: START,
			last_processed_block: 0,
			...overrides,
		} as never)
		.execute();
}

async function createSchema(
	def: SubgraphDefinition,
	pgSchema: string,
): Promise<void> {
	createdSchemas.push(pgSchema);
	for (const stmt of generateSubgraphSQL(def, pgSchema).statements) {
		await sql.raw(stmt).execute(db);
	}
}

/** Heights that actually produced rows — the honest picture of what survived. */
async function rowHeights(pgSchema: string): Promise<number[]> {
	const { rows } = await sql
		.raw(
			`SELECT DISTINCT _block_height::int AS h FROM "${pgSchema}"."balances" ORDER BY h`,
		)
		.execute(db);
	return (rows as { h: number }[]).map((r) => r.h);
}

async function subgraphRow(name: string) {
	return await db
		.selectFrom("subgraphs")
		.select([
			"status",
			"last_processed_block",
			"reindex_from_block",
			"reindex_to_block",
		])
		.where("name", "=", name)
		.executeTakeFirstOrThrow();
}

function unique(prefix: string): { name: string; pgSchema: string } {
	const id = randomUUID().slice(0, 8).replace(/-/g, "");
	return { name: `f079-${prefix}-${id}`, pgSchema: `sg_f079_${prefix}_${id}` };
}

beforeAll(async () => {
	db = getDb();
	priorTip = await readTip();
	await seedChain();
	await setTip(TIP);
});

afterAll(async () => {
	for (const s of createdSchemas) {
		await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
	}
	for (const n of createdSubgraphNames) {
		await db.deleteFrom("subgraphs").where("name", "=", n).execute();
	}
	await db
		.deleteFrom("events")
		.where("tx_id", "like", `${TX_ID_PREFIX}%`)
		.execute();
	await db
		.deleteFrom("transactions")
		.where("tx_id", "like", `${TX_ID_PREFIX}%`)
		.execute();
	await db
		.deleteFrom("blocks")
		.where("hash", "like", `${BLOCK_HASH_PREFIX}%`)
		.execute();
	// Restore the chain tip other suites in this process may depend on.
	if (priorTip != null) await setTip(priorTip);
});

describe("a reindex never leaves rows only inside a sub-range", () => {
	test("a single-block range supplied by the caller still rebuilds the whole span", async () => {
		const { name, pgSchema } = unique("norange");
		const def = makeDef(name);
		createdSchemas.push(pgSchema);
		await registerSubgraph(def, pgSchema);

		// Healthy baseline: the full span.
		await reindexSubgraph(def, { schemaName: pgSchema });
		expect(await rowHeights(pgSchema)).toEqual(EVENT_HEIGHTS);

		// The incident's exact call, forced past the type system the way the
		// pre-fix API route and CLI supplied it. Pre-fix this left ONE row
		// (height 3400) and reported success; the other four were gone for good.
		await reindexSubgraph(def, {
			fromBlock: TIP,
			toBlock: TIP,
			schemaName: pgSchema,
		} as unknown as ReindexOptions);

		expect(await rowHeights(pgSchema)).toEqual(EVENT_HEIGHTS);

		// ...and the state that made the loss invisible is genuinely healthy now.
		const row = await subgraphRow(name);
		expect(row.status).toBe("active");
		expect(Number(row.last_processed_block)).toBe(TIP);
	});

	test("reindex clears its resume metadata on completion", async () => {
		const { name, pgSchema } = unique("meta");
		const def = makeDef(name);
		createdSchemas.push(pgSchema);
		await registerSubgraph(def, pgSchema);

		await reindexSubgraph(def, { schemaName: pgSchema });

		const row = await subgraphRow(name);
		expect(row.reindex_from_block).toBeNull();
		expect(row.reindex_to_block).toBeNull();
	});
});

describe("resume metadata still drives an interrupted reindex", () => {
	test("resume walks only the remaining blocks and keeps the committed prefix", async () => {
		const { name, pgSchema } = unique("resume");
		const def = makeDef(name);

		// An interrupted reindex: schema already built, cursor parked mid-span,
		// resume metadata recording the range the interrupted run resolved.
		await createSchema(def, pgSchema);
		await registerSubgraph(def, pgSchema, {
			status: "reindexing",
			last_processed_block: 3_200,
			reindex_from_block: START,
			reindex_to_block: TIP,
		});

		await resumeReindex(def, { schemaName: pgSchema });

		// Only the tail was walked — resume must not drop the schema, and must
		// not re-apply the deltas the interrupted run already committed.
		expect(await rowHeights(pgSchema)).toEqual([3_300, 3_400]);

		const row = await subgraphRow(name);
		expect(row.status).toBe("active");
		expect(Number(row.last_processed_block)).toBe(TIP);
		expect(row.reindex_from_block).toBeNull();
		expect(row.reindex_to_block).toBeNull();
	});
});

describe("the free-tier floor still clamps the walk", () => {
	test("a floor above the registered start block raises where the rebuild begins", async () => {
		const { name, pgSchema } = unique("floor");
		const def = makeDef(name);
		createdSchemas.push(pgSchema);
		await registerSubgraph(def, pgSchema);

		// What the API route passes for a clamped (free-tier) account. It raises
		// the start; it still runs all the way to chain tip.
		await reindexSubgraph(def, {
			schemaName: pgSchema,
			startBlockFloor: 3_200,
		});

		expect(await rowHeights(pgSchema)).toEqual([3_200, 3_300, 3_400]);
		expect(Number((await subgraphRow(name)).last_processed_block)).toBe(TIP);
	});
});
