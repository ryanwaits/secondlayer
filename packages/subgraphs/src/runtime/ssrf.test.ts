import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "@secondlayer/shared/db";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import { startEmitter } from "./emitter.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/secondlayer";

// This test exercises the refusal path — do NOT set ALLOW_PRIVATE_EGRESS.
delete process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS;

const db = getDb();
const accountId = randomUUID();
let stopEmitter: (() => Promise<void>) | null = null;

beforeAll(async () => {
	stopEmitter = await startEmitter({ pollIntervalMs: 500 });
});

afterAll(async () => {
	await stopEmitter?.();
	await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", accountId)
		.execute();
	await closeDb();
});

describe("SSRF egress guard", () => {
	it("refuses localhost + 127.0.0.1 by default, writes delivery row with error", async () => {
		const cases = [
			{ url: "http://127.0.0.1:9999/hook", name: `loopback-${randomUUID().slice(0, 8)}` },
			{ url: "http://localhost/hook", name: `localhost-${randomUUID().slice(0, 8)}` },
			{ url: "http://10.1.2.3/hook", name: `priva10-${randomUUID().slice(0, 8)}` },
			{
				url: "http://192.168.1.1/hook",
				name: `priva192-${randomUUID().slice(0, 8)}`,
			},
			{
				url: "http://169.254.169.254/hook",
				name: `linklocal-${randomUUID().slice(0, 8)}`,
			},
			{
				url: "http://[::ffff:127.0.0.1]/hook",
				name: `v6mapv4-${randomUUID().slice(0, 8)}`,
			},
			{
				url: "http://[::ffff:7f00:0001]/hook",
				name: `v6maphex-${randomUUID().slice(0, 8)}`,
			},
			{
				url: "http://[::1]/hook",
				name: `v6loop-${randomUUID().slice(0, 8)}`,
			},
			{
				url: "http://0.0.0.0/hook",
				name: `any-${randomUUID().slice(0, 8)}`,
			},
		];

		const subs: string[] = [];
		for (const c of cases) {
			const { subscription } = await createSubscription(db, {
				accountId,
				name: c.name,
				subgraphName: "bitcoin",
				tableName: "transfers",
				url: c.url,
			});
			subs.push(subscription.id);
			await db
				.insertInto("subscription_outbox")
				.values({
					subscription_id: subscription.id,
					subgraph_name: "bitcoin",
					table_name: "transfers",
					block_height: 1,
					tx_id: "0x",
					row_pk: { blockHeight: 1, txId: "0x", rowIndex: 0 },
					event_type: "bitcoin.transfers.created",
					payload: { amount: "1" },
					dedup_key: `ssrf-${randomUUID()}`,
				})
				.execute();
		}

		// Let the emitter poll + try to dispatch.
		const deadline = Date.now() + 5_000;
		let seen = 0;
		while (seen < subs.length && Date.now() < deadline) {
			const rows = await db
				.selectFrom("subscription_deliveries")
				.select("subscription_id")
				.where("subscription_id", "in", subs)
				.execute();
			seen = new Set(rows.map((r) => r.subscription_id)).size;
			if (seen >= subs.length) break;
			await new Promise((r) => setTimeout(r, 100));
		}

		const rows = await db
			.selectFrom("subscription_deliveries")
			.selectAll()
			.where("subscription_id", "in", subs)
			.execute();

		expect(rows.length).toBeGreaterThanOrEqual(subs.length);
		for (const r of rows) {
			expect(r.status_code).toBeNull();
			expect(r.error_message).toContain("refused private egress");
		}
	}, 10_000);
});
