import { afterAll, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type Stripe from "stripe";
import { processStripeEvent } from "./webhooks-stripe.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const db = getDb();

// Track seeded account ids for cleanup
const seededAccountIds: string[] = [];

async function makeAccount(email: string): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email })
		.returning("id")
		.executeTakeFirstOrThrow();
	seededAccountIds.push(row.id);
	return row.id;
}

async function cleanupAccount(accountId: string): Promise<void> {
	// account_credits FK cascades on delete; processed_stripe_events has no FK
	await db
		.deleteFrom("account_credits")
		.where("account_id", "=", accountId)
		.execute();
}

async function cleanupEvents(eventId: string): Promise<void> {
	await sql`DELETE FROM processed_stripe_events WHERE event_id = ${eventId}`.execute(
		db,
	);
}

afterAll(async () => {
	for (const id of seededAccountIds) {
		await db.deleteFrom("accounts").where("id", "=", id).execute();
	}
});

function makeCheckoutEvent(
	eventId: string,
	accountId: string,
	amountTotal: number,
): Stripe.Event {
	return {
		id: eventId,
		type: "checkout.session.completed",
		data: {
			object: {
				mode: "payment",
				payment_status: "paid",
				metadata: {
					kind: "credits_topup",
					secondlayer_account_id: accountId,
				},
				amount_total: amountTotal,
			} as unknown as Stripe.Checkout.Session,
		},
	} as Stripe.Event;
}

describe("processStripeEvent", () => {
	test("happy path: credits account and inserts marker row", async () => {
		if (!HAS_DB) return;

		const accountId = await makeAccount(
			`webhook-test-happy-${Date.now()}@test.invalid`,
		);
		const eventId = `evt_happy_${crypto.randomUUID()}`;

		await cleanupEvents(eventId);
		await cleanupAccount(accountId);

		const outcome = await processStripeEvent(
			db,
			makeCheckoutEvent(eventId, accountId, 5000),
		);

		expect(outcome).toBe("processed");

		// Marker row must exist
		const marker = await db
			.selectFrom("processed_stripe_events")
			.select("event_id")
			.where("event_id", "=", eventId)
			.executeTakeFirst();
		expect(marker?.event_id).toBe(eventId);

		// Credits must be applied: 5000 cents * 10_000 = 50_000_000 micros
		const credits = await db
			.selectFrom("account_credits")
			.select("balance_usd_micros")
			.where("account_id", "=", accountId)
			.executeTakeFirst();
		expect(credits).toBeDefined();
		expect(BigInt(credits?.balance_usd_micros ?? "0")).toBe(50_000_000n);

		// Cleanup
		await cleanupEvents(eventId);
		await cleanupAccount(accountId);
	});

	test("atomic rollback: failed handler rolls back marker row", async () => {
		if (!HAS_DB) return;

		// Use a non-existent account id — account_credits FK will throw
		const badAccountId = "00000000-0000-0000-0000-000000000000";
		const eventId = `evt_rollback_${crypto.randomUUID()}`;

		await cleanupEvents(eventId);

		// processStripeEvent must reject (FK violation inside transaction)
		await expect(
			processStripeEvent(db, makeCheckoutEvent(eventId, badAccountId, 5000)),
		).rejects.toThrow();

		// The processed_stripe_events row must NOT exist (transaction rolled back)
		const marker = await db
			.selectFrom("processed_stripe_events")
			.select("event_id")
			.where("event_id", "=", eventId)
			.executeTakeFirst();
		expect(marker).toBeUndefined();
	});

	test("duplicate: second call returns 'duplicate' without reapplying effect", async () => {
		if (!HAS_DB) return;

		const accountId = await makeAccount(
			`webhook-test-dup-${Date.now()}@test.invalid`,
		);
		const eventId = `evt_dup_${crypto.randomUUID()}`;

		await cleanupEvents(eventId);
		await cleanupAccount(accountId);

		const first = await processStripeEvent(
			db,
			makeCheckoutEvent(eventId, accountId, 1000),
		);
		expect(first).toBe("processed");

		const second = await processStripeEvent(
			db,
			makeCheckoutEvent(eventId, accountId, 1000),
		);
		expect(second).toBe("duplicate");

		// Balance must equal exactly one top-up (1000 cents = 10_000_000 micros)
		const credits = await db
			.selectFrom("account_credits")
			.select("balance_usd_micros")
			.where("account_id", "=", accountId)
			.executeTakeFirst();
		expect(BigInt(credits?.balance_usd_micros ?? "0")).toBe(10_000_000n);

		// Cleanup
		await cleanupEvents(eventId);
		await cleanupAccount(accountId);
	});
});
