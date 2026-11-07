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
import { backfillSubgraph } from "./reindex.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

// Heights no other suite seeds. FIRST..LAST exist except MISSING.
const FIRST = 7_300;
const LAST = 7_305;
const MISSING = 7_303;
const ASSET = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.gapfill::gapfill";

let db: Kysely<Database>;
const schemaNames: string[] = [];
const subgraphNames: string[] = [];

const schema = {
	counters: {
		columns: { id: { type: "principal", indexed: true } },
		uniqueKeys: [["id"]],
	},
} as unknown as SubgraphSchema;

beforeAll(async () => {
	db = getDb();
	const blocks = [];
	for (let h = FIRST; h <= LAST; h++) {
		if (h === MISSING) continue;
		blocks.push({
			height: h,
			hash: `0xgapfill${h}`,
			parent_hash: `0xgapfill${h - 1}`,
			burn_block_height: h + 900_000,
			burn_block_hash: null,
			timestamp: 1_700_000_000 + h,
			canonical: true,
		});
	}
	await db
		.insertInto("blocks")
		.values(blocks)
		.onConflict((oc) => oc.column("height").doNothing())
		.execute();
});

afterAll(async () => {
	for (const s of schemaNames) {
		await sql.raw(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).execute(db);
	}
	if (subgraphNames.length > 0) {
		await db
			.deleteFrom("subgraph_operations")
			.where("subgraph_name", "in", subgraphNames)
			.execute();
		await db
			.deleteFrom("subgraph_gaps")
			.where("subgraph_name", "in", subgraphNames)
			.execute();
		await db
			.deleteFrom("subgraphs")
			.where("name", "in", subgraphNames)
			.execute();
	}
	await db.deleteFrom("blocks").where("hash", "like", "0xgapfill%").execute();
});

async function registerSubgraph(name: string, pgSchema: string) {
	const def = {
		name,
		startBlock: FIRST,
		sources: { mint: { type: "ft_mint", assetIdentifier: ASSET } },
		schema,
		handlers: { mint: (() => {}) as unknown as SubgraphHandler },
	} as unknown as SubgraphDefinition;
	subgraphNames.push(name);
	schemaNames.push(pgSchema);
	const row = await db
		.insertInto("subgraphs")
		.values({
			name,
			status: "active",
			definition: def as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			schema_name: pgSchema,
			account_id: randomUUID(),
			start_block: FIRST,
			last_processed_block: LAST,
		} as never)
		.returning("id")
		.executeTakeFirstOrThrow();
	for (const stmt of generateSubgraphSQL(def, pgSchema).statements) {
		await sql.raw(stmt).execute(db);
	}
	return { def, subgraphId: String(row.id) };
}

function insertGap(
	subgraphId: string,
	name: string,
	start: number,
	end: number,
	detectedAt: Date,
) {
	return db
		.insertInto("subgraph_gaps")
		.values({
			subgraph_id: subgraphId,
			subgraph_name: name,
			gap_start: start,
			gap_end: end,
			reason: "block_missing",
			detected_at: detectedAt,
		} as never)
		.execute();
}

async function openGaps(name: string): Promise<[number, number][]> {
	const rows = await db
		.selectFrom("subgraph_gaps")
		.select(["gap_start", "gap_end"])
		.where("subgraph_name", "=", name)
		.where("resolved_at", "is", null)
		.orderBy("gap_start")
		.execute();
	return rows.map((r) => [Number(r.gap_start), Number(r.gap_end)]);
}

describe("backfill gap resolution", () => {
	test("a block that fails mid-backfill leaves its gap open while older gaps in the range resolve", async () => {
		const id = randomUUID().slice(0, 8);
		const name = `gapfill-${id}`;
		const { def, subgraphId } = await registerSubgraph(
			name,
			`sg_gapfill_${id}`,
		);
		// An earlier-detected gap over blocks this run re-covers cleanly.
		await insertGap(
			subgraphId,
			name,
			FIRST,
			FIRST + 1,
			new Date(Date.now() - 60_000),
		);
		const op = await db
			.insertInto("subgraph_operations")
			.values({
				subgraph_id: subgraphId,
				subgraph_name: name,
				kind: "backfill",
				status: "running",
				from_block: FIRST,
				to_block: LAST,
			} as never)
			.returning("id")
			.executeTakeFirstOrThrow();

		await backfillSubgraph(def, {
			fromBlock: FIRST,
			toBlock: LAST,
			operationId: String(op.id),
		});

		// MISSING never loads, so the gap this run recorded for it survives the
		// resolve; the earlier gap over healthy blocks is closed.
		expect(await openGaps(name)).toEqual([[MISSING, MISSING]]);
	}, 30_000);
});
