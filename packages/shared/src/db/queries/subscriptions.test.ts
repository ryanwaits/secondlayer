import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "../index.ts";
import {
	createSubscription,
	deleteSubscription,
	getSubscription,
	getSubscriptionByName,
	getSubscriptionSigningSecret,
	listSubscriptions,
	rotateSubscriptionSecret,
	toggleSubscriptionStatus,
	updateSubscription,
} from "./subscriptions.ts";

// Requires local Postgres via `bun run db` and migrations applied.
// INSTANCE_MODE=oss so the crypto/secrets bootstrap doesn't throw.
process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/secondlayer";

const db = getDb();

let accountId: string;

beforeAll(async () => {
	// Minimal account row — the subscriptions table references no FK on
	// accounts, so a real account isn't strictly required, but generate a
	// stable id for this test run so `account_id` filtering is meaningful.
	accountId = randomUUID();
});

afterAll(async () => {
	// Don't closeDb() — destroying the shared singleton breaks sibling
	// test files when `bun test` runs them together.
	await db.deleteFrom("subscriptions").where("account_id", "=", accountId).execute();
});

beforeEach(async () => {
	await db.deleteFrom("subscriptions").where("account_id", "=", accountId).execute();
});

describe("subscriptions queries", () => {
	const baseInput = () => ({
		accountId,
		name: "test-sub",
		subgraphName: "my-subgraph",
		tableName: "transfers",
		url: "https://webhook.site/abc",
	});

	it("create returns encrypted secret + plaintext once", async () => {
		const { subscription, signingSecret } = await createSubscription(
			db,
			baseInput(),
		);
		expect(subscription.id).toBeTruthy();
		expect(subscription.name).toBe("test-sub");
		expect(subscription.status).toBe("active");
		expect(subscription.format).toBe("standard-webhooks");
		expect(signingSecret).toMatch(/^[a-f0-9]{64}$/);
		expect(subscription.signing_secret_enc).toBeInstanceOf(Buffer);
		expect(getSubscriptionSigningSecret(subscription)).toBe(signingSecret);
	});

	it("create enforces unique (account_id, name)", async () => {
		await createSubscription(db, baseInput());
		await expect(createSubscription(db, baseInput())).rejects.toThrow();
	});

	it("list returns subscriptions newest-first", async () => {
		const a = await createSubscription(db, { ...baseInput(), name: "a" });
		const b = await createSubscription(db, { ...baseInput(), name: "b" });
		const rows = await listSubscriptions(db, accountId);
		expect(rows.length).toBe(2);
		expect(rows[0].id).toBe(b.subscription.id);
		expect(rows[1].id).toBe(a.subscription.id);
	});

	it("get by id scopes to account_id", async () => {
		const { subscription } = await createSubscription(db, baseInput());
		const found = await getSubscription(db, accountId, subscription.id);
		expect(found?.id).toBe(subscription.id);
		const missed = await getSubscription(db, randomUUID(), subscription.id);
		expect(missed).toBeNull();
	});

	it("get by name scopes to account_id", async () => {
		await createSubscription(db, baseInput());
		const found = await getSubscriptionByName(db, accountId, "test-sub");
		expect(found?.name).toBe("test-sub");
	});

	it("update patches url + format", async () => {
		const { subscription } = await createSubscription(db, baseInput());
		const patched = await updateSubscription(db, accountId, subscription.id, {
			url: "https://new.example/hook",
			format: "inngest",
			runtime: "inngest",
		});
		expect(patched?.url).toBe("https://new.example/hook");
		expect(patched?.format).toBe("inngest");
		expect(patched?.runtime).toBe("inngest");
	});

	it("toggleStatus pause resets circuit breaker", async () => {
		const { subscription } = await createSubscription(db, baseInput());
		await db
			.updateTable("subscriptions")
			.set({ circuit_failures: 10, circuit_opened_at: new Date() })
			.where("id", "=", subscription.id)
			.execute();
		const resumed = await toggleSubscriptionStatus(
			db,
			accountId,
			subscription.id,
			"active",
		);
		expect(resumed?.status).toBe("active");
		expect(resumed?.circuit_failures).toBe(0);
		expect(resumed?.circuit_opened_at).toBeNull();
	});

	it("rotateSecret yields new plaintext + persists new envelope", async () => {
		const { subscription, signingSecret } = await createSubscription(
			db,
			baseInput(),
		);
		const rotated = await rotateSubscriptionSecret(db, accountId, subscription.id);
		expect(rotated?.signingSecret).not.toBe(signingSecret);
		expect(getSubscriptionSigningSecret(rotated!.subscription)).toBe(
			rotated!.signingSecret,
		);
	});

	it("delete removes the row + returns true", async () => {
		const { subscription } = await createSubscription(db, baseInput());
		const ok = await deleteSubscription(db, accountId, subscription.id);
		expect(ok).toBe(true);
		const after = await getSubscription(db, accountId, subscription.id);
		expect(after).toBeNull();
	});

	it("delete scoped to account_id", async () => {
		const { subscription } = await createSubscription(db, baseInput());
		const ok = await deleteSubscription(db, randomUUID(), subscription.id);
		expect(ok).toBe(false);
		const after = await getSubscription(db, accountId, subscription.id);
		expect(after).not.toBeNull();
	});
});
