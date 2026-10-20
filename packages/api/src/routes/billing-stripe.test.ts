import { afterAll, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type Stripe from "stripe";
import { isSentinelEvent, processStripeEvent } from "./billing-stripe.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const db = HAS_DB ? getDb() : (null as never);

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

function makeRefillEvent(
	eventId: string,
	accountId: string,
	amount: number,
): Stripe.Event {
	return {
		id: eventId,
		type: "payment_intent.succeeded",
		data: {
			object: {
				amount,
				amount_received: amount,
				metadata: {
					kind: "credits_refill",
					secondlayer_account_id: accountId,
				},
			} as unknown as Stripe.PaymentIntent,
		},
	} as Stripe.Event;
}

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

describe.skipIf(!HAS_DB)("processStripeEvent", () => {
	test("happy path: credits account and inserts marker row", async () => {
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

	test("refill payment_intent.succeeded credits the account", async () => {
		const accountId = await makeAccount(
			`webhook-test-refill-${Date.now()}@test.invalid`,
		);
		const eventId = `evt_refill_${crypto.randomUUID()}`;
		await cleanupEvents(eventId);
		await cleanupAccount(accountId);

		const outcome = await processStripeEvent(
			db,
			makeRefillEvent(eventId, accountId, 2500),
		);
		expect(outcome).toBe("processed");
		const credits = await db
			.selectFrom("account_credits")
			.select("balance_usd_micros")
			.where("account_id", "=", accountId)
			.executeTakeFirst();
		expect(BigInt(credits?.balance_usd_micros ?? "0")).toBe(25_000_000n);
		await cleanupEvents(eventId);
		await cleanupAccount(accountId);
	});

	test("unhandled event type (legacy subscription lifecycle) is acked with marker and no effect", async () => {
		// Prod Stripe may still deliver subscription events for pre-retirement
		// data — they must be marked processed (so the route 200s), never 500.
		const eventId = `evt_legacy_sub_${crypto.randomUUID()}`;
		await cleanupEvents(eventId);

		const outcome = await processStripeEvent(db, {
			id: eventId,
			type: "customer.subscription.updated",
			data: { object: {} as unknown as Stripe.Subscription },
		} as Stripe.Event);
		expect(outcome).toBe("processed");

		const marker = await db
			.selectFrom("processed_stripe_events")
			.select("event_id")
			.where("event_id", "=", eventId)
			.executeTakeFirst();
		expect(marker?.event_id).toBe(eventId);

		await cleanupEvents(eventId);
	});

	test("atomic rollback: failed handler rolls back marker row", async () => {
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

// Sentinel shares this Stripe account and tags its objects
// `metadata.product = "sentinel"`. These events must never reach the database.
describe("Sentinel-tagged events", () => {
	const noDb = new Proxy(
		{},
		{
			get() {
				throw new Error("a Sentinel event must not touch the database");
			},
		},
	) as never;

	const sentinel = { product: "sentinel", sentinel_user_id: "u_1" };
	const accountId = "00000000-0000-0000-0000-000000000001";

	const events: [string, Stripe.Event][] = [
		[
			"checkout session (even tagged as a credits top-up)",
			{
				id: "evt_s_checkout",
				type: "checkout.session.completed",
				data: {
					object: {
						mode: "payment",
						payment_status: "paid",
						amount_total: 5000,
						metadata: {
							...sentinel,
							kind: "credits_topup",
							secondlayer_account_id: accountId,
						},
					},
				},
			} as unknown as Stripe.Event,
		],
		[
			"payment intent (even tagged as a credits refill)",
			{
				id: "evt_s_pi",
				type: "payment_intent.succeeded",
				data: {
					object: {
						amount: 5000,
						amount_received: 5000,
						metadata: {
							...sentinel,
							kind: "credits_refill",
							secondlayer_account_id: accountId,
						},
					},
				},
			} as unknown as Stripe.Event,
		],
		[
			"subscription",
			{
				id: "evt_s_sub",
				type: "customer.subscription.updated",
				data: { object: { metadata: sentinel } },
			} as unknown as Stripe.Event,
		],
		[
			"customer",
			{
				id: "evt_s_cus",
				type: "customer.updated",
				data: { object: { metadata: sentinel } },
			} as unknown as Stripe.Event,
		],
		[
			"invoice (subscription metadata, current API shape)",
			{
				id: "evt_s_inv",
				type: "invoice.paid",
				data: {
					object: {
						metadata: {},
						parent: { subscription_details: { metadata: sentinel } },
					},
				},
			} as unknown as Stripe.Event,
		],
		[
			"invoice (subscription metadata, older API shape)",
			{
				id: "evt_s_inv_old",
				type: "invoice.payment_failed",
				data: {
					object: { subscription_details: { metadata: sentinel } },
				},
			} as unknown as Stripe.Event,
		],
	];

	test.each(events)(
		"%s is ignored before any database use",
		async (_n, event) => {
			expect(isSentinelEvent(event)).toBe(true);
			expect(await processStripeEvent(noDb, event)).toBe("ignored");
		},
	);

	test("secondlayer's own events are not mistaken for Sentinel's", () => {
		for (const metadata of [
			undefined,
			{},
			{ kind: "credits_topup", secondlayer_account_id: accountId },
			{ product: "secondlayer" },
		]) {
			expect(
				isSentinelEvent({
					id: "evt_own",
					type: "checkout.session.completed",
					data: { object: { metadata } },
				} as unknown as Stripe.Event),
			).toBe(false);
		}
	});

	test.skipIf(!HAS_DB)(
		"a Sentinel top-up lookalike credits nobody and leaves no marker",
		async () => {
			const id = await makeAccount(
				`webhook-test-sentinel-${Date.now()}@test.invalid`,
			);
			const eventId = `evt_sentinel_${crypto.randomUUID()}`;
			await cleanupEvents(eventId);
			await cleanupAccount(id);

			const event = {
				id: eventId,
				type: "checkout.session.completed",
				data: {
					object: {
						mode: "payment",
						payment_status: "paid",
						amount_total: 5000,
						metadata: {
							...sentinel,
							kind: "credits_topup",
							secondlayer_account_id: id,
						},
					},
				},
			} as unknown as Stripe.Event;
			expect(await processStripeEvent(db, event)).toBe("ignored");

			expect(
				await db
					.selectFrom("account_credits")
					.select("balance_usd_micros")
					.where("account_id", "=", id)
					.executeTakeFirst(),
			).toBeUndefined();
			expect(
				await db
					.selectFrom("processed_stripe_events")
					.select("event_id")
					.where("event_id", "=", eventId)
					.executeTakeFirst(),
			).toBeUndefined();
		},
	);
});
