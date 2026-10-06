import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setSystemTime,
	test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { BillingPausedError } from "@secondlayer/shared/index-http";
import type { LeaderBackend } from "@secondlayer/shared/leader";
import type { Kysely } from "kysely";
import { generateSubgraphSQL } from "../schema/generator.ts";
import type {
	SubgraphDefinition,
	SubgraphHandler,
	SubgraphSchema,
} from "../types.ts";
import {
	BILLING_PAUSE_BACKOFF_MS,
	inBillingBackoff,
	loadWhileBillingPaused,
} from "./billing-pause.ts";
import { startCatchUpLeader } from "./catchup-leader.ts";
import { catchUpSubgraph } from "./catchup.ts";
import type { SubgraphContext } from "./context.ts";
import { type FakeIndexOptions, startFakeIndex } from "./fake-index.ts";

/**
 * A hosted account past its free rows is refused `402` on every read. That is
 * a deliberate billing state: the subgraph must wait and resume from its
 * cursor, not fail, burn its error count, or land in `error`.
 */
process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const TIP = 120;
const TARGET = "SP000000000000000000002Q6VF78.pox-5";
const chain: FakeIndexOptions = {
	tip: TIP,
	backgroundPrintsPerBlock: 1,
	backgroundContracts: 1,
	targetContract: TARGET,
	targetEvery: 50,
	otherTopic: "tick",
	wantedTopic: "tick",
	wantedHeights: [],
};

const ENV_KEYS = ["SUBGRAPH_SOURCE", "SUBGRAPH_INDEX_API_URL"] as const;
const priorEnv = new Map<string, string | undefined>();

let db: Kysely<Database>;
let stopLeader: () => Promise<void>;
const pgSchema = `sg_billing_${randomUUID().slice(0, 8).replace(/-/g, "")}`;
const name = `billing-pause-${randomUUID().slice(0, 8)}`;
const fake = startFakeIndex(chain);

const schema = {
	ticks: { columns: { tx_id: { type: "text" } } },
} as unknown as SubgraphSchema;

const def = {
	name,
	sources: {
		tick: { type: "print_event", contractId: TARGET, topic: "tick" },
	},
	schema,
	handlers: {
		tick: (async (_e: unknown, ctx: SubgraphContext) => {
			ctx.insert("ticks", { tx_id: ctx.tx.txId });
		}) as unknown as SubgraphHandler,
	},
} as unknown as SubgraphDefinition;

async function row() {
	return db
		.selectFrom("subgraphs")
		.select(["status", "last_processed_block", "total_errors", "last_error"])
		.where("name", "=", name)
		.executeTakeFirstOrThrow();
}

beforeAll(async () => {
	db = getDb();
	for (const k of ENV_KEYS) priorEnv.set(k, process.env[k]);
	process.env.SUBGRAPH_SOURCE = "streams-index";
	process.env.SUBGRAPH_INDEX_API_URL = fake.url;
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
	// catchUpSubgraph bails unless this process holds the catch-up lease.
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
	setSystemTime();
	fake.stop();
	for (const k of ENV_KEYS) {
		const v = priorEnv.get(k);
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	await sql.raw(`DROP SCHEMA IF EXISTS "${pgSchema}" CASCADE`).execute(db);
	await db.deleteFrom("subgraphs").where("name", "=", name).execute();
});

describe("catch-up while reads are refused for billing", () => {
	test("pauses without erroring, then resumes from the cursor and clears the code", async () => {
		fake.refuse("spend_cap_reached");
		await catchUpSubgraph(def, name);

		let sg = await row();
		expect(sg.status).toBe("active");
		expect(Number(sg.total_errors)).toBe(0);
		expect(Number(sg.last_processed_block)).toBe(0);
		expect(sg.last_error).toBe("billing_paused: spend_cap_reached");
		expect(inBillingBackoff(name)).toBe(true);

		// Inside the backoff window the refused read is not hammered.
		const refusedBefore = fake.stats.refused;
		await catchUpSubgraph(def, name);
		expect(fake.stats.refused).toBe(refusedBefore);

		// Reads work again and the backoff has passed: resume and clear.
		fake.refuse(null);
		setSystemTime(new Date(Date.now() + BILLING_PAUSE_BACKOFF_MS + 1_000));
		await catchUpSubgraph(def, name);
		setSystemTime();

		sg = await row();
		expect(sg.status).toBe("active");
		expect(Number(sg.last_processed_block)).toBe(TIP);
		expect(sg.last_error).toBeNull();
		expect(Number(sg.total_errors)).toBe(0);
		expect(inBillingBackoff(name)).toBe(false);
	});
});

describe("loadWhileBillingPaused", () => {
	const refusal = () => new BillingPausedError("insufficient_credits", "402");

	test("retries the same load after a refusal and clears the recorded code", async () => {
		await db
			.updateTable("subgraphs")
			.set({ last_error: null })
			.where("name", "=", name)
			.execute();
		let reloads = 0;
		const first = Promise.reject(refusal());
		first.catch(() => {});
		const value = await loadWhileBillingPaused(
			db,
			name,
			first,
			async () => {
				reloads++;
				expect((await row()).last_error).toBe(
					"billing_paused: insufficient_credits",
				);
				return "batch";
			},
			{ backoffMs: 5 },
		);
		expect(value).toBe("batch");
		expect(reloads).toBe(1);
		expect((await row()).last_error).toBeNull();
	});

	test("an abort during the wait returns without a result", async () => {
		const ctl = new AbortController();
		const first = Promise.reject(refusal());
		first.catch(() => {});
		setTimeout(() => ctl.abort("shutdown"), 10);
		const value = await loadWhileBillingPaused(
			db,
			name,
			first,
			async () => "never",
			{ backoffMs: 60_000, signal: ctl.signal },
		);
		expect(value).toBeUndefined();
	});

	test("any other error propagates untouched", async () => {
		const first = Promise.reject(new Error("boom"));
		first.catch(() => {});
		await expect(
			loadWhileBillingPaused(db, name, first, async () => "x", {
				backoffMs: 5,
			}),
		).rejects.toThrow("boom");
		expect((await row()).status).toBe("active");
	});
});
