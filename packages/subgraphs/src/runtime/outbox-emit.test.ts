import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import type { Kysely } from "kysely";
import { SubscriptionMatcher } from "./emitter-matcher.ts";
import { emitSubscriptionOutbox } from "./outbox-emit.ts";
import { refreshMatcher } from "./subscription-state.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5435/secondlayer";

let db: Kysely<Database>;
let accountId: string;

beforeAll(async () => {
	db = getDb();
	accountId = randomUUID();
});

afterAll(async () => {
	// Don't closeDb() — see emitter.test.ts comment. Per-suite cleanup only.
	await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", accountId)
		.execute();
});

describe("emitSubscriptionOutbox", () => {
	it("inserts outbox rows only for matching active subs, deduped across replays", async () => {
		const { subscription } = await createSubscription(db, {
			accountId,
			name: `test-${randomUUID().slice(0, 8)}`,
			subgraphName: "bitcoin",
			tableName: "transfers",
			url: "https://webhook.site/xxx",
			filter: { amount: { gte: 100 } },
		});

		const matcher = new SubscriptionMatcher();
		await refreshMatcher(db);
		// Rehydrate our local matcher from the same DB state (the singleton
		// is global but we need a scoped view for this test).
		matcher.setAll([subscription]);

		const manifest = {
			count: 3,
			writes: [
				{
					op: "insert" as const,
					table: "transfers",
					row: { sender: "SP1", recipient: "SP2", amount: "500" },
					pk: { blockHeight: 1000, txId: "0xaaa", rowIndex: 0 },
				},
				{
					op: "insert" as const,
					table: "transfers",
					row: { sender: "SP3", recipient: "SP4", amount: "50" }, // fails filter
					pk: { blockHeight: 1000, txId: "0xbbb", rowIndex: 1 },
				},
				{
					op: "update" as const, // non-insert skipped
					table: "transfers",
					row: { sender: "SP1", amount: "1000" },
					pk: { blockHeight: 1000, txId: "0xaaa", rowIndex: 2 },
				},
			],
		};

		await db.transaction().execute(async (tx) => {
			const n = await emitSubscriptionOutbox(
				tx,
				"bitcoin",
				manifest,
				matcher,
				1000,
			);
			expect(n).toBe(1);
		});

		const rows = await db
			.selectFrom("subscription_outbox")
			.selectAll()
			.where("subscription_id", "=", subscription.id)
			.execute();
		expect(rows).toHaveLength(1);
		expect(rows[0].event_type).toBe("bitcoin.transfers.created");
		const payload = rows[0].payload as Record<string, unknown>;
		expect(payload.sender).toBe("SP1");

		// Replay: same manifest → ON CONFLICT DO NOTHING, no extra rows.
		await db.transaction().execute(async (tx) => {
			await emitSubscriptionOutbox(tx, "bitcoin", manifest, matcher, 1000);
		});
		const after = await db
			.selectFrom("subscription_outbox")
			.select(sql<number>`count(*)::int`.as("c"))
			.where("subscription_id", "=", subscription.id)
			.executeTakeFirstOrThrow();
		expect(Number(after.c)).toBe(1);
	});

	it("kill-switch bypasses emission", async () => {
		const { subscription } = await createSubscription(db, {
			accountId,
			name: `killswitch-${randomUUID().slice(0, 8)}`,
			subgraphName: "bitcoin",
			tableName: "mints",
			url: "https://webhook.site/xxx",
		});

		const matcher = new SubscriptionMatcher();
		matcher.setAll([subscription]);

		const manifest = {
			count: 1,
			writes: [
				{
					op: "insert" as const,
					table: "mints",
					row: { recipient: "SP1", amount: "100" },
					pk: { blockHeight: 2000, txId: "0xccc", rowIndex: 0 },
				},
			],
		};

		process.env.SECONDLAYER_EMIT_OUTBOX = "false";
		try {
			await db.transaction().execute(async (tx) => {
				const n = await emitSubscriptionOutbox(
					tx,
					"bitcoin",
					manifest,
					matcher,
					2000,
				);
				expect(n).toBe(0);
			});
		} finally {
			process.env.SECONDLAYER_EMIT_OUTBOX = undefined;
		}

		const rows = await db
			.selectFrom("subscription_outbox")
			.selectAll()
			.where("subscription_id", "=", subscription.id)
			.execute();
		expect(rows).toHaveLength(0);
	});
});
