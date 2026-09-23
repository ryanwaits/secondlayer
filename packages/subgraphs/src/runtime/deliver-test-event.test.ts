import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import type { Kysely } from "kysely";
import { deliverTestEvent } from "./emitter.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

let db: Kysely<Database>;
let accountId: string;
let priorAllowEnv: string | undefined;

// The delivery case posts to a local server, so it needs the private-egress
// opt-in. It used to inherit that from whichever emitter suite loaded first in
// the same process, which made it pass or fail on file order.
beforeAll(() => {
	db = getDb();
	accountId = randomUUID();
	priorAllowEnv = process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS;
	process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = "true";
});

afterAll(async () => {
	if (priorAllowEnv === undefined)
		delete process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS;
	else process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = priorAllowEnv;
	await db.deleteFrom("webhooks").where("account_id", "=", accountId).execute();
});

describe("deliverTestEvent", () => {
	it("delivers a test webhook and logs a delivery row with null outbox_id", async () => {
		// Non-routable URL → the attempt fails (SSRF refusal or connection error),
		// but the full path runs: buildForFormat → postToWebhook → delivery log.
		const { webhook } = await createWebhook(db, {
			accountId,
			name: `test-${randomUUID().slice(0, 8)}`,
			subgraphName: "bitcoin",
			tableName: "transfers",
			url: "http://127.0.0.1:9/hook",
			filter: {},
		});

		const result = await deliverTestEvent(db, webhook);
		expect(result.ok).toBe(false);
		expect(result.error).toBeTruthy();
		expect(result.deliveryId).toBeTruthy();

		const row = await db
			.selectFrom("webhook_deliveries")
			.selectAll()
			.where("id", "=", result.deliveryId)
			.executeTakeFirst();
		expect(row?.webhook_id).toBe(webhook.id);
		// Test deliveries aren't tied to a queued outbox row.
		expect(row?.outbox_id).toBeNull();
	});

	it("test-ping payload has webhook_id only", async () => {
		let captured: string | null = null;
		const server = Bun.serve({
			port: 0,
			fetch: async (req) => {
				captured = await req.text();
				return new Response("ok", { status: 200 });
			},
		});
		try {
			const { webhook } = await createWebhook(db, {
				accountId,
				name: `dual-${randomUUID().slice(0, 8)}`,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: `http://127.0.0.1:${server.port}/hook`,
				filter: {},
			});
			const result = await deliverTestEvent(db, webhook);
			expect(result.ok).toBe(true);
			expect(captured).toBeTruthy();
			if (!captured) throw new Error("expected captured body");
			const body = JSON.parse(captured) as {
				data?: { webhook_id?: string; subscription_id?: string };
			};
			expect(body.data?.webhook_id).toBe(webhook.id);
			expect(body.data?.subscription_id).toBeUndefined();
		} finally {
			server.stop(true);
		}
	});
});
