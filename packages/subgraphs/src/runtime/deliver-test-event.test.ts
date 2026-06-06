import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import type { Kysely } from "kysely";
import { deliverTestEvent } from "./emitter.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

let db: Kysely<Database>;
let accountId: string;

beforeAll(() => {
	db = getDb();
	accountId = randomUUID();
});

afterAll(async () => {
	await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", accountId)
		.execute();
});

describe("deliverTestEvent", () => {
	it("delivers a test webhook and logs a delivery row with null outbox_id", async () => {
		// Non-routable URL → the attempt fails (SSRF refusal or connection error),
		// but the full path runs: buildForFormat → postToSubscription → delivery log.
		const { subscription } = await createSubscription(db, {
			accountId,
			name: `test-${randomUUID().slice(0, 8)}`,
			subgraphName: "bitcoin",
			tableName: "transfers",
			url: "http://127.0.0.1:9/hook",
			filter: {},
		});

		const result = await deliverTestEvent(db, subscription);
		expect(result.ok).toBe(false);
		expect(result.error).toBeTruthy();
		expect(result.deliveryId).toBeTruthy();

		const row = await db
			.selectFrom("subscription_deliveries")
			.selectAll()
			.where("id", "=", result.deliveryId)
			.executeTakeFirst();
		expect(row?.subscription_id).toBe(subscription.id);
		// Test deliveries aren't tied to a queued outbox row.
		expect(row?.outbox_id).toBeNull();
	});
});
