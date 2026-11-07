import { afterAll, describe, expect, test } from "bun:test";
import {
	debitCredits,
	getCredits,
} from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import type Stripe from "stripe";
import { processStripeEvent } from "./billing-stripe.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const accountIds: string[] = [];

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: true })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

afterAll(async () => {
	if (!HAS_DB || accountIds.length === 0) return;
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

const evt = (type: string, object: unknown): Stripe.Event =>
	({
		id: `evt_${crypto.randomUUID()}`,
		type,
		data: { object },
	}) as unknown as Stripe.Event;

function checkout(accountId: string, paymentIntent: string, cents: number) {
	return evt("checkout.session.completed", {
		mode: "payment",
		payment_status: "paid",
		payment_intent: paymentIntent,
		amount_total: cents,
		metadata: {
			kind: "credits_topup",
			secondlayer_account_id: accountId,
		},
	});
}

function refill(accountId: string, paymentIntent: string, cents: number) {
	return evt("payment_intent.succeeded", {
		id: paymentIntent,
		amount: cents,
		amount_received: cents,
		metadata: {
			kind: "credits_refill",
			secondlayer_account_id: accountId,
		},
	});
}

function refunded(paymentIntent: string, amountRefundedCents: number) {
	return evt("charge.refunded", {
		payment_intent: paymentIntent,
		amount_refunded: amountRefundedCents,
		metadata: {},
	});
}

function dispute(paymentIntent: string, disputeId: string, cents: number) {
	return evt("charge.dispute.created", {
		id: disputeId,
		payment_intent: paymentIntent,
		amount: cents,
	});
}

const pi = () => `pi_${crypto.randomUUID()}`;

async function refundRows(accountId: string) {
	return db
		.selectFrom("usage_ledger")
		.select(["usd_micros", "debited_usd_micros", "source"])
		.where("account_id", "=", accountId)
		.where("unit", "=", "refund")
		.orderBy("recorded_at")
		.execute();
}

describe.skipIf(!HAS_DB)(
	"Stripe top-ups are keyed on the payment intent",
	() => {
		test("the same payment on two events credits once", async () => {
			const accountId = await makeAccount();
			const intent = pi();
			await processStripeEvent(db, checkout(accountId, intent, 2500));
			await processStripeEvent(db, checkout(accountId, intent, 2500));
			expect(await getCredits(db, accountId)).toBe(25_000_000n);
			const rows = await db
				.selectFrom("usage_ledger")
				.select("idempotency_key")
				.where("account_id", "=", accountId)
				.execute();
			expect(rows.map((r) => r.idempotency_key)).toEqual([
				`stripe:pi:${intent}`,
			]);
		});

		test("an auto-refill payment on two events credits once", async () => {
			const accountId = await makeAccount();
			const intent = pi();
			await processStripeEvent(db, refill(accountId, intent, 1000));
			await processStripeEvent(db, refill(accountId, intent, 1000));
			expect(await getCredits(db, accountId)).toBe(10_000_000n);
		});
	},
);

describe.skipIf(!HAS_DB)("Stripe refunds and disputes take credit back", () => {
	test("a full refund removes the top-up from the balance", async () => {
		const accountId = await makeAccount();
		const intent = pi();
		await processStripeEvent(db, checkout(accountId, intent, 5000));
		expect(await processStripeEvent(db, refunded(intent, 5000))).toBe(
			"processed",
		);
		expect(await getCredits(db, accountId)).toBe(0n);
		expect(await refundRows(accountId)).toEqual([
			{
				usd_micros: "50000000",
				debited_usd_micros: "50000000",
				source: "stripe:refund",
			},
		]);
	});

	test("partial refunds add up and a redelivered or older step never counts twice", async () => {
		const accountId = await makeAccount();
		const intent = pi();
		await processStripeEvent(db, checkout(accountId, intent, 5000));

		await processStripeEvent(db, refunded(intent, 1000)); // $10 refunded
		expect(await getCredits(db, accountId)).toBe(40_000_000n);

		await processStripeEvent(db, refunded(intent, 2500)); // $25 cumulative
		expect(await getCredits(db, accountId)).toBe(25_000_000n);

		// Same cumulative amount on a new event id, and an older step arriving late.
		await processStripeEvent(db, refunded(intent, 2500));
		await processStripeEvent(db, refunded(intent, 1000));
		expect(await getCredits(db, accountId)).toBe(25_000_000n);

		const taken = (await refundRows(accountId)).map((r) =>
			BigInt(r.debited_usd_micros),
		);
		expect(taken).toEqual([10_000_000n, 15_000_000n]);
	});

	test("a refund after the credit was spent takes only the balance and records the shortfall", async () => {
		const accountId = await makeAccount();
		const intent = pi();
		await processStripeEvent(db, checkout(accountId, intent, 1000)); // $10
		await debitCredits(db, accountId, 9_990_000n); // 10_000 µ$ left

		await processStripeEvent(db, refunded(intent, 1000));

		expect(await getCredits(db, accountId)).toBe(0n);
		expect(await refundRows(accountId)).toEqual([
			{
				usd_micros: "10000000",
				debited_usd_micros: "10000",
				source: "stripe:refund",
			},
		]);
	});

	test("a dispute takes the disputed amount once, even when the event repeats", async () => {
		const accountId = await makeAccount();
		const intent = pi();
		await processStripeEvent(db, checkout(accountId, intent, 5000));

		await processStripeEvent(db, dispute(intent, "dp_1", 5000));
		await processStripeEvent(db, dispute(intent, "dp_1", 5000));

		expect(await getCredits(db, accountId)).toBe(0n);
		const rows = await refundRows(accountId);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.source).toBe("stripe:dispute");
		expect(BigInt(rows[0]?.usd_micros ?? "0")).toBe(50_000_000n);
	});

	test("a dispute never drives the balance negative", async () => {
		const accountId = await makeAccount();
		const intent = pi();
		await processStripeEvent(db, checkout(accountId, intent, 2000));
		await debitCredits(db, accountId, 19_000_000n);

		await processStripeEvent(db, dispute(intent, "dp_2", 2000));

		expect(await getCredits(db, accountId)).toBe(0n);
	});

	test("a refund for a payment that is not one of our top-ups changes nothing", async () => {
		const accountId = await makeAccount();
		await processStripeEvent(db, checkout(accountId, pi(), 5000));

		expect(await processStripeEvent(db, refunded(pi(), 5000))).toBe(
			"processed",
		);
		expect(await processStripeEvent(db, dispute(pi(), "dp_3", 5000))).toBe(
			"processed",
		);

		expect(await getCredits(db, accountId)).toBe(50_000_000n);
		expect(await refundRows(accountId)).toEqual([]);
	});

	test("a refund finds its account from the charge metadata when the top-up predates payment-intent keys", async () => {
		const accountId = await makeAccount();
		const intent = pi();
		await db
			.insertInto("account_credits")
			.values({ account_id: accountId, balance_usd_micros: "20000000" })
			.execute();
		const event = evt("charge.refunded", {
			payment_intent: intent,
			amount_refunded: 500,
			metadata: {
				kind: "credits_topup",
				secondlayer_account_id: accountId,
			},
		});
		await processStripeEvent(db, event);
		expect(await getCredits(db, accountId)).toBe(15_000_000n);
	});
});
