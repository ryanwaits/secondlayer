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
import { type FakeIndexOptions, startFakeIndex } from "./fake-index.ts";
import { reindexSubgraph } from "./reindex.ts";

/**
 * A reindex over the hosted Index plane fetches only what its filters can
 * match, and leaps over stretches where a contract prints only topics the
 * subgraph does not declare. Drives the real client + runtime against a fake
 * Index HTTP server that counts every row it returns (what would be billed).
 */
process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const TIP = 1_000;
const TARGET = "SP000000000000000000002Q6VF78.pox-5";
const WANTED_HEIGHT = 900;
const chain: FakeIndexOptions = {
	tip: TIP,
	backgroundPrintsPerBlock: 20,
	backgroundContracts: 10,
	targetContract: TARGET,
	// Prints other topics at 150, 300, ... and the wanted topic at one height.
	targetEvery: 150,
	otherTopic: "stack-stx",
	wantedTopic: "containment-probe",
	wantedHeights: [WANTED_HEIGHT],
};

const ENV_KEYS = [
	"SUBGRAPH_SOURCE",
	"SUBGRAPH_INDEX_API_URL",
	"SUBGRAPH_REINDEX_BATCH_SIZE",
	"SUBGRAPH_REINDEX_MIN_BATCH_SIZE",
	"SUBGRAPH_REINDEX_MAX_BATCH_SIZE",
] as const;
const priorEnv = new Map<string, string | undefined>();

let db: Kysely<Database>;
const pgSchema = `sg_sparse_topic_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
const name = `sparse-topic-${randomUUID().slice(0, 8)}`;
const fake = startFakeIndex(chain);

const schema = {
	probes: {
		columns: { tx_id: { type: "text" } },
	},
} as unknown as SubgraphSchema;

const def = {
	name,
	sources: {
		probe: {
			type: "print_event",
			contractId: TARGET,
			topic: "containment-probe",
		},
	},
	schema,
	handlers: {
		probe: (async (_e: unknown, ctx: SubgraphContext) => {
			ctx.insert("probes", { tx_id: ctx.tx.txId });
		}) as unknown as SubgraphHandler,
	},
} as unknown as SubgraphDefinition;

beforeAll(async () => {
	db = getDb();
	for (const k of ENV_KEYS) priorEnv.set(k, process.env[k]);
	process.env.SUBGRAPH_SOURCE = "streams-index";
	process.env.SUBGRAPH_INDEX_API_URL = fake.url;
	process.env.SUBGRAPH_REINDEX_BATCH_SIZE = "100";
	process.env.SUBGRAPH_REINDEX_MIN_BATCH_SIZE = "100";
	process.env.SUBGRAPH_REINDEX_MAX_BATCH_SIZE = "100";
	for (const stmt of generateSubgraphSQL(def, pgSchema).statements) {
		await sql.raw(stmt).execute(db);
	}
	await db
		.insertInto("subgraphs")
		.values({
			name,
			status: "active",
			definition: def as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			schema_name: pgSchema,
			account_id: randomUUID(),
			start_block: 1,
			last_processed_block: 0,
		} as never)
		.execute();
});

afterAll(async () => {
	fake.stop();
	for (const k of ENV_KEYS) {
		const v = priorEnv.get(k);
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	await sql.raw(`DROP SCHEMA IF EXISTS "${pgSchema}" CASCADE`).execute(db);
	await db.deleteFrom("subgraphs").where("name", "=", name).execute();
});

describe("hosted reindex fetches only what the subgraph can match", () => {
	test("returns only the pinned contract's prints and skips past other-topic stretches", async () => {
		await reindexSubgraph(def, { schemaName: pgSchema });

		// The one print with the declared topic reached the handler.
		const { rows } = await sql
			.raw(`SELECT count(*)::int AS n FROM "${pgSchema}"."probes"`)
			.execute(db);
		expect((rows as { n: number }[])[0]?.n).toBe(1);

		// Every events request was scoped to the contract; none walked the chain.
		expect(fake.stats.eventRequests.length).toBeGreaterThan(0);
		expect(fake.stats.eventRequests.every((r) => r.contractId === TARGET)).toBe(
			true,
		);

		// Billed event rows == the target's own prints (+ at most one per probe),
		// not the ~20 background prints per block on the chain.
		const targetPrints = Math.floor(TIP / chain.targetEvery) + 1;
		const probes = fake.stats.eventRequests.filter((r) => r.limit1).length;
		expect(fake.stats.rows.events).toBeLessThanOrEqual(targetPrints + probes);

		// Batches whose only prints carried another topic were skipped past: fewer
		// block headers were fetched than the chain has blocks.
		expect(fake.stats.rows.blocks).toBeLessThan(TIP * 0.75);
	});
});
