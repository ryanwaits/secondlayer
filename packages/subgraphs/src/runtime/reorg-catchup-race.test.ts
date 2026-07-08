import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import type { SubgraphDefinition, SubgraphSchema } from "../types.ts";
import { catchUpSubgraph } from "./catchup.ts";
import { handleSubgraphReorg } from "./reorg.ts";

/**
 * f057: a catch-up walk's forward cursor write must never clobber a
 * concurrent reorg's backward rewind.
 *
 * `recordLiveProgress` (packages/shared/src/db/queries/subgraphs.ts) writes
 * `last_processed_block` unconditionally (no monotonic guard — the reorg
 * rewind must be able to move it backward). Pre-fix, `catchUpSubgraph`'s
 * ascending walk read the cursor once at the start and never re-checked it,
 * so if a reorg rewound the cursor to the fork height while a catch-up tick
 * was already walking blocks above that height, the catch-up's next commit
 * re-advanced `last_processed_block` past the fork — discarding the rewind.
 * Heights from the fork up to the pre-reorg cursor then never got
 * reprocessed against the new canonical chain.
 *
 * This subgraph has empty `sources`/`schema` on purpose: `matchSources`
 * always returns no matches, so `processBlock` takes its "no match" fast
 * path (block-processor.ts) — a plain `recordLiveProgress` write with no
 * per-subgraph data-plane schema needed. That isolates the race to exactly
 * the cursor column this plan is about.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

let db: Kysely<Database>;
const accountId = randomUUID();
const createdSubgraphNames: string[] = [];
const TOTAL_BLOCKS = 2000;
const FORK_HEIGHT = 5;

function makeDef(name: string): SubgraphDefinition {
	return {
		name,
		startBlock: 1,
		sources: {},
		schema: {} as SubgraphSchema,
		handlers: {},
	};
}

async function registerSubgraph(name: string): Promise<void> {
	createdSubgraphNames.push(name);
	await db
		.insertInto("subgraphs")
		.values({
			name,
			status: "active",
			definition: makeDef(name) as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			schema_name: `sg_f057_${name.replace(/-/g, "_")}`,
			account_id: accountId,
			start_block: 1,
		})
		.execute();
}

async function seedChain(toHeight: number): Promise<void> {
	const values = [];
	for (let h = 1; h <= toHeight; h++) {
		values.push({
			height: h,
			hash: `0xf057h${h}`,
			parent_hash: `0xf057h${h - 1}`,
			burn_block_height: h + 900_000,
			burn_block_hash: null,
			timestamp: 1_700_000_000 + h,
			canonical: true,
		});
	}
	// Chunk inserts — a single 2000-row values() list is fine for Postgres but
	// keep it modest in case of parameter-count limits.
	const CHUNK = 500;
	for (let i = 0; i < values.length; i += CHUNK) {
		await db
			.insertInto("blocks")
			.values(values.slice(i, i + CHUNK))
			.onConflict((oc) => oc.column("height").doNothing())
			.execute();
	}
	const network = process.env.NETWORK ?? "mainnet";
	await db
		.insertInto("index_progress")
		.values({ network, highest_seen_block: toHeight })
		.onConflict((oc) =>
			oc.column("network").doUpdateSet({ highest_seen_block: toHeight }),
		)
		.execute();
}

async function cursorOf(name: string): Promise<number> {
	const row = await db
		.selectFrom("subgraphs")
		.select("last_processed_block")
		.where("name", "=", name)
		.executeTakeFirstOrThrow();
	return Number(row.last_processed_block);
}

beforeAll(async () => {
	db = getDb();
	await seedChain(TOTAL_BLOCKS);
});

afterAll(async () => {
	for (const name of createdSubgraphNames) {
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
	await db.deleteFrom("blocks").where("hash", "like", "0xf057h%").execute();
});

describe("f057: reorg rewind vs in-flight catch-up walk", () => {
	it("does not let a catch-up write clobber a reorg rewind that lands mid-walk", async () => {
		const name = `f057-race-${randomUUID().slice(0, 8)}`;
		await registerSubgraph(name);

		// Start a real catch-up walk over 2000 blocks (no preloaded fixtures —
		// this drives the actual PostgresBlockSource + processBlockWithRetry path
		// catch-up uses in production).
		const catchupPromise = catchUpSubgraph(makeDef(name), name);

		// Give the walk a real head start so it is unambiguously past the fork
		// height and still mid-walk (2000 blocks at real DB round-trip latency
		// takes well over 50ms) when the reorg fires below.
		await new Promise((resolve) => setTimeout(resolve, 50));
		await handleSubgraphReorg(FORK_HEIGHT, async () => makeDef(name));

		const processedThisTick = await catchupPromise;

		// The reorg's rewind must stand: the cursor must land at (not above) the
		// fork height. Pre-fix, the catch-up walk's already in-flight batch kept
		// committing forward after the rewind, leaving the cursor near its
		// pre-reorg (much higher) value instead.
		expect(await cursorOf(name)).toBe(FORK_HEIGHT);

		// The walk must have aborted well short of the full 2000 blocks — proof
		// it detected the reorg mid-flight rather than running to completion
		// and only incidentally landing on the right number.
		expect(processedThisTick).toBeLessThan(TOTAL_BLOCKS);
	});
});
