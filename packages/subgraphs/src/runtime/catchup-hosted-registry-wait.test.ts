import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import type { LeaderBackend } from "@secondlayer/shared/leader";
import type { Kysely } from "kysely";
import type { SubgraphDefinition, SubgraphSchema } from "../types.ts";
import { startCatchUpLeader } from "./catchup-leader.ts";
import { catchUpSubgraph } from "./catchup.ts";
import { startFakeIndex } from "./fake-index.ts";

/**
 * A hosted tenant has no registry tables: the Index API reports how far its
 * contract registry has classified in the tip. A trait-scoped subgraph's
 * catch-up must stop there, exactly as a self-hosted one does, or a token
 * deployed just below the tip is processed before it is labelled and its
 * events are skipped for good.
 */

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const TIP = 150;
const ENV_KEYS = ["SUBGRAPH_SOURCE", "SUBGRAPH_INDEX_API_URL"] as const;
const priorEnv = new Map<string, string | undefined>();

const fake = startFakeIndex({
	tip: TIP,
	backgroundPrintsPerBlock: 0,
	backgroundContracts: 1,
	targetContract: "SP9.hosted-registry-wait",
	targetEvery: 1_000_000,
	otherTopic: "tick",
	wantedTopic: "tick",
	wantedHeights: [],
});

let db: Kysely<Database>;
/** A hosted tenant has no local index_progress row; other suites leave one. */
let priorProgress: { network: string; highest_seen_block: string } | undefined;
let stopLeader: () => Promise<void>;
const accountId = randomUUID();
const createdSubgraphNames: string[] = [];

function makeDef(name: string): SubgraphDefinition {
	return {
		name,
		startBlock: 1,
		sources: { transfers: { type: "ft_transfer", trait: "sip-010" } },
		schema: {} as SubgraphSchema,
		handlers: {},
	} as unknown as SubgraphDefinition;
}

async function registerSubgraph(name: string): Promise<string> {
	createdSubgraphNames.push(name);
	const row = await db
		.insertInto("subgraphs")
		.values({
			name,
			status: "active",
			definition: makeDef(name) as unknown as Record<string, unknown>,
			schema_hash: "test",
			handler_path: "test",
			schema_name: `sg_hostedwait_${name.replace(/-/g, "_")}`,
			account_id: accountId,
			start_block: 1,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return row.id;
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
	const network = process.env.NETWORK ?? "mainnet";
	priorProgress = (await db
		.selectFrom("index_progress")
		.select(["network", "highest_seen_block"])
		.where("network", "=", network)
		.executeTakeFirst()) as typeof priorProgress;
	await db
		.deleteFrom("index_progress")
		.where("network", "=", network)
		.execute();
	for (const k of ENV_KEYS) priorEnv.set(k, process.env[k]);
	process.env.SUBGRAPH_SOURCE = "streams-index";
	process.env.SUBGRAPH_INDEX_API_URL = fake.url;
	stopLeader = startCatchUpLeader({
		createBackend: (): LeaderBackend => ({
			tryAcquire: async () => true,
			ping: async () => {},
			close: async () => {},
		}),
		pollMs: 10_000,
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
});

afterAll(async () => {
	await stopLeader();
	fake.stop();
	for (const k of ENV_KEYS) {
		const v = priorEnv.get(k);
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	for (const name of createdSubgraphNames) {
		await db.deleteFrom("subgraphs").where("name", "=", name).execute();
	}
	if (priorProgress) {
		await db
			.insertInto("index_progress")
			.values({
				network: priorProgress.network,
				highest_seen_block: Number(priorProgress.highest_seen_block),
			})
			.execute();
	}
});

describe("hosted catch-up waits for the contract registry", () => {
	it("stops at the registry height the tip reports and resumes when it advances", async () => {
		fake.setRegistryClassifiedThrough(100);
		const name = `hostedwait-${randomUUID().slice(0, 8)}`;
		const id = await registerSubgraph(name);

		await catchUpSubgraph(makeDef(name), name, id);
		expect(await cursorOf(name)).toBe(100);

		fake.setRegistryClassifiedThrough(TIP);
		await catchUpSubgraph(makeDef(name), name, id);
		expect(await cursorOf(name)).toBe(TIP);
	});

	it("runs to the tip against a server whose tip omits the registry height", async () => {
		fake.setRegistryClassifiedThrough(undefined);
		const name = `hostedwait-old-${randomUUID().slice(0, 8)}`;
		const id = await registerSubgraph(name);

		await catchUpSubgraph(makeDef(name), name, id);

		expect(await cursorOf(name)).toBe(TIP);
	});
});
