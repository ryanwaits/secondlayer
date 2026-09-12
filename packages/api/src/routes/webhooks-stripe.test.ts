import { afterAll, describe, expect, test } from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
import type Stripe from "stripe";
import { hashToken } from "../auth/keys.ts";
import { createClaimToken } from "../play/tokens.ts";
import { processStripeEvent } from "./webhooks-stripe.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const db = HAS_DB ? getDb() : (null as never);

// Track seeded account ids for cleanup
const seededAccountIds: string[] = [];
const seededSubgraphNames: string[] = [];

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
	if (seededSubgraphNames.length > 0) {
		await db
			.deleteFrom("subgraphs")
			.where("name", "in", seededSubgraphNames)
			.execute();
	}
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
	claimTokenHash?: string,
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
					...(claimTokenHash ? { claim_token_hash: claimTokenHash } : {}),
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

	test("top-up webhook resumes paused subgraphs", async () => {
		const accountId = await makeAccount(
			`webhook-test-resume-${Date.now()}@test.invalid`,
		);
		const eventId = `evt_resume_${crypto.randomUUID()}`;
		const name = `webhook-resume-${crypto.randomUUID().slice(0, 8)}`;
		seededSubgraphNames.push(name);
		await cleanupEvents(eventId);
		await cleanupAccount(accountId);

		await db
			.insertInto("subgraphs")
			.values({
				name,
				status: "paused",
				definition: {},
				schema_hash: "test",
				handler_path: "test",
				schema_name: `subgraph_webhook_${crypto.randomUUID().slice(0, 8)}`,
				account_id: accountId,
				last_processed_block: 0,
				database_url_enc: null,
			})
			.execute();

		const outcome = await processStripeEvent(
			db,
			makeCheckoutEvent(eventId, accountId, 1000),
		);
		expect(outcome).toBe("processed");

		const sg = await db
			.selectFrom("subgraphs")
			.select("status")
			.where("name", "=", name)
			.where("account_id", "=", accountId)
			.executeTakeFirstOrThrow();
		expect(sg.status).toBe("active");

		await cleanupEvents(eventId);
		await cleanupAccount(accountId);
	});

	test("claim checkout transfers paused subgraph then resumes it", async () => {
		const ghost = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();
		seededAccountIds.push(ghost.id);
		const destId = await makeAccount(
			`webhook-test-claim-resume-${Date.now()}@test.invalid`,
		);
		const eventId = `evt_claim_resume_${crypto.randomUUID()}`;
		const name = `webhook-claim-resume-${crypto.randomUUID().slice(0, 8)}`;
		seededSubgraphNames.push(name);
		await cleanupEvents(eventId);
		await cleanupAccount(destId);

		await db
			.insertInto("subgraphs")
			.values({
				name,
				status: "paused",
				definition: {},
				schema_hash: "test",
				handler_path: "test",
				schema_name: `subgraph_webhook_${crypto.randomUUID().slice(0, 8)}`,
				account_id: ghost.id,
				last_processed_block: 0,
				database_url_enc: null,
			})
			.execute();
		const claim = await createClaimToken(db, ghost.id);

		const outcome = await processStripeEvent(
			db,
			makeCheckoutEvent(eventId, destId, 1000, hashToken(claim.raw)),
		);
		expect(outcome).toBe("processed");

		const sg = await db
			.selectFrom("subgraphs")
			.select(["account_id", "status"])
			.where("name", "=", name)
			.executeTakeFirstOrThrow();
		expect(sg.account_id).toBe(destId);
		expect(sg.status).toBe("active");

		const ghostRow = await db
			.selectFrom("accounts")
			.select("id")
			.where("id", "=", ghost.id)
			.executeTakeFirst();
		expect(ghostRow).toBeUndefined();

		await cleanupEvents(eventId);
		await cleanupAccount(destId);
	});
});
