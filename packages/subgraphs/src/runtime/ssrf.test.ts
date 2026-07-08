import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import { createSubscription } from "@secondlayer/shared/db/queries/subscriptions";
import {
	__setDnsLookupForTest,
	checkEgressAllowed,
	startEmitter,
} from "./emitter.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

const db = getDb();
const accountId = randomUUID();
let stopEmitter: (() => Promise<void>) | null = null;
// Scope the env-var mutation to this suite's lifecycle. Sibling test
// files set ALLOW_PRIVATE_EGRESS=true at module load; a bare
// `delete process.env.X` at this file's module load would race them
// (bun loads modules in arbitrary order before running tests).
let priorAllowEnv: string | undefined;

beforeAll(async () => {
	priorAllowEnv = process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS;
	process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = undefined;
	stopEmitter = await startEmitter({ pollIntervalMs: 500 });
});

afterAll(async () => {
	// Don't closeDb() — see emitter.test.ts comment.
	await stopEmitter?.();
	await db
		.deleteFrom("subscriptions")
		.where("account_id", "=", accountId)
		.execute();
	if (priorAllowEnv !== undefined) {
		process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = priorAllowEnv;
	}
});

describe("SSRF egress guard", () => {
	it("refuses localhost + 127.0.0.1 by default, writes delivery row with error", async () => {
		const cases = [
			{
				url: "http://127.0.0.1:9999/hook",
				name: `loopback-${randomUUID().slice(0, 8)}`,
			},
			{
				url: "http://localhost/hook",
				name: `localhost-${randomUUID().slice(0, 8)}`,
			},
			{
				url: "http://10.1.2.3/hook",
				name: `priva10-${randomUUID().slice(0, 8)}`,
			},
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

/** Poll `subscription_deliveries` for the first row belonging to `subscriptionId`. */
async function waitForDeliveryRow(subscriptionId: string, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const row = await db
			.selectFrom("subscription_deliveries")
			.selectAll()
			.where("subscription_id", "=", subscriptionId)
			.executeTakeFirst();
		if (row) return row;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(
		`no delivery row for subscription ${subscriptionId} after ${timeoutMs}ms`,
	);
}

describe("SSRF egress guard — DNS rebinding", () => {
	afterEach(() => {
		// Restore the real resolver after every test in this block so an
		// injected stub never leaks into sibling test files sharing this
		// bun test process.
		__setDnsLookupForTest(null);
	});

	it("refuses a hostname that resolves (not literally) to a private IP", async () => {
		const hostname = `rebind-${randomUUID().slice(0, 8)}.test.invalid`;
		__setDnsLookupForTest(async (host) => {
			if (host === hostname) return [{ address: "127.0.0.1", family: 4 }];
			throw new Error(`unexpected DNS lookup for ${host} in this test`);
		});

		const { subscription } = await createSubscription(db, {
			accountId,
			name: `rebind-${randomUUID().slice(0, 8)}`,
			subgraphName: "bitcoin",
			tableName: "transfers",
			url: `http://${hostname}/hook`,
		});
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
				dedup_key: `ssrf-rebind-${randomUUID()}`,
			})
			.execute();

		const row = await waitForDeliveryRow(subscription.id);
		expect(row.status_code).toBeNull();
		expect(row.error_message).toContain("refused private egress");
		expect(row.error_message).toContain("127.0.0.1");
	}, 10_000);

	it("refuses a hostname that resolves to the metadata IP 169.254.169.254", async () => {
		const hostname = `metadata-${randomUUID().slice(0, 8)}.test.invalid`;
		__setDnsLookupForTest(async (host) => {
			if (host === hostname) {
				return [{ address: "169.254.169.254", family: 4 }];
			}
			throw new Error(`unexpected DNS lookup for ${host} in this test`);
		});

		const { subscription } = await createSubscription(db, {
			accountId,
			name: `metadata-${randomUUID().slice(0, 8)}`,
			subgraphName: "bitcoin",
			tableName: "transfers",
			url: `http://${hostname}/hook`,
		});
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
				dedup_key: `ssrf-metadata-${randomUUID()}`,
			})
			.execute();

		const row = await waitForDeliveryRow(subscription.id);
		expect(row.status_code).toBeNull();
		expect(row.error_message).toContain("refused private egress");
		expect(row.error_message).toContain("169.254.169.254");
	}, 10_000);

	it("does not over-block a hostname that resolves only to public addresses", async () => {
		const hostname = `public-${randomUUID().slice(0, 8)}.test.invalid`;
		__setDnsLookupForTest(async (host) => {
			if (host === hostname) {
				// example.com's real v4 + a real public v6 — neither is private.
				return [
					{ address: "93.184.216.34", family: 4 },
					{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
				];
			}
			throw new Error(`unexpected DNS lookup for ${host} in this test`);
		});

		const refusal = await checkEgressAllowed(`http://${hostname}/hook`);
		expect(refusal).toBeNull();
	});
});
