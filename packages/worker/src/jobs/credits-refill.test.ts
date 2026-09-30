import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	creditCredits,
	getCreditRefill,
	setCreditRefill,
} from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import type Stripe from "stripe";
import { runDueRefills, startCreditsRefillCron } from "./credits-refill.ts";

describe("credits refill cron", () => {
	let prev: string | undefined;

	beforeEach(() => {
		prev = process.env.INSTANCE_MODE;
		process.env.INSTANCE_MODE = "oss";
	});

	afterEach(() => {
		if (prev === undefined) delete process.env.INSTANCE_MODE;
		else process.env.INSTANCE_MODE = prev;
	});

	test("does not schedule in oss mode", () => {
		const stop = startCreditsRefillCron();
		stop();
		expect(typeof stop).toBe("function");
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const ids: string[] = [];

async function makeDueAccount(): Promise<{ id: string; email: string }> {
	const email = `refill-${crypto.randomUUID().slice(0, 8)}@example.com`;
	const row = await db
		.insertInto("accounts")
		.values({
			email,
			ghost: false,
			stripe_customer_id: `cus_${crypto.randomUUID()}`,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	ids.push(row.id);
	await creditCredits(db, row.id, 1_000_000n);
	await setCreditRefill(db, row.id, {
		belowUsdMicros: 5_000_000n,
		packUsd: 25,
	});
	return { id: row.id, email };
}

type Create = (
	params: Stripe.PaymentIntentCreateParams,
	opts?: Stripe.RequestOptions,
) => Promise<unknown>;

function stubStripe(create: Create): Stripe {
	return {
		customers: {
			retrieve: async () => ({
				id: "cus_test",
				invoice_settings: { default_payment_method: "pm_test" },
			}),
		},
		paymentMethods: { list: async () => ({ data: [] }) },
		paymentIntents: { create },
	} as unknown as Stripe;
}

afterAll(async () => {
	if (!HAS_DB || ids.length === 0) return;
	await db
		.deleteFrom("account_credits")
		.where("account_id", "in", ids)
		.execute();
	await db.deleteFrom("accounts").where("id", "in", ids).execute();
});

describe.skipIf(!HAS_DB)("runDueRefills", () => {
	test("charges with a per-attempt idempotency key and keeps auto top-up on", async () => {
		const { id } = await makeDueAccount();
		const seen: { params: Stripe.PaymentIntentCreateParams; key?: string }[] =
			[];
		const mails: unknown[] = [];
		await runDueRefills({
			stripe: stubStripe(async (params, opts) => {
				seen.push({ params, key: opts?.idempotencyKey });
				return { status: "succeeded" };
			}),
			sendEmail: async (m) => {
				mails.push(m);
				return { id: "x" } as never;
			},
		});
		const mine = seen.filter(
			(s) => s.params.metadata?.secondlayer_account_id === id,
		);
		expect(mine).toHaveLength(1);
		const refill = await getCreditRefill(db, id);
		expect(mine[0]?.key).toBe(`refill:${id}:${refill.lastAt?.toISOString()}`);
		expect(refill.belowUsdMicros).toBe(5_000_000n);
		expect(mails).toHaveLength(0);
	});

	test("a declined card turns auto top-up off, emails once, never retries", async () => {
		const { id, email } = await makeDueAccount();
		let calls = 0;
		const mails: { to: string; subject: string }[] = [];
		const deps = {
			stripe: stubStripe(async (params) => {
				if (params.metadata?.secondlayer_account_id === id) calls += 1;
				throw Object.assign(new Error("Your card was declined."), {
					type: "StripeCardError",
					code: "card_declined",
				});
			}),
			sendEmail: async (m: { to: string; subject: string }) => {
				mails.push(m);
				return { id: "x" } as never;
			},
		};
		await runDueRefills(deps);
		const refill = await getCreditRefill(db, id);
		expect(refill.belowUsdMicros).toBeNull();
		expect(refill.packUsd).toBeNull();
		expect(mails.filter((m) => m.to === email)).toHaveLength(1);
		expect(mails.find((m) => m.to === email)?.subject).toContain("declined");

		// Second and later runs: not due, no charge, no email.
		await runDueRefills(deps);
		expect(calls).toBe(1);
		expect(mails.filter((m) => m.to === email)).toHaveLength(1);
	});

	test("authentication_required turns it off with the authentication email", async () => {
		const { id, email } = await makeDueAccount();
		const mails: { to: string; subject: string }[] = [];
		await runDueRefills({
			stripe: stubStripe(async () => {
				throw Object.assign(new Error("auth"), {
					type: "StripeCardError",
					code: "authentication_required",
				});
			}),
			sendEmail: async (m) => {
				mails.push(m as never);
				return { id: "x" } as never;
			},
		});
		expect((await getCreditRefill(db, id)).belowUsdMicros).toBeNull();
		const mine = mails.filter((m) => m.to === email);
		expect(mine).toHaveLength(1);
		expect(mine[0]?.subject).toContain("authentication");
	});

	test("a requires_action intent counts as authentication_required", async () => {
		const { id } = await makeDueAccount();
		await runDueRefills({
			stripe: stubStripe(async () => ({ status: "requires_action" })),
			sendEmail: async () => ({ id: "x" }) as never,
		});
		expect((await getCreditRefill(db, id)).belowUsdMicros).toBeNull();
	});

	test("a transient Stripe error keeps auto top-up on and sends no email", async () => {
		const { id } = await makeDueAccount();
		const mails: unknown[] = [];
		await runDueRefills({
			stripe: stubStripe(async () => {
				throw Object.assign(new Error("network"), {
					type: "StripeConnectionError",
				});
			}),
			sendEmail: async (m) => {
				mails.push(m);
				return { id: "x" } as never;
			},
		});
		expect((await getCreditRefill(db, id)).belowUsdMicros).toBe(5_000_000n);
		expect(mails).toHaveLength(0);
	});

	test("a failed email doesn't undo turning auto top-up off", async () => {
		const { id } = await makeDueAccount();
		await runDueRefills({
			stripe: stubStripe(async () => {
				throw Object.assign(new Error("declined"), { code: "card_declined" });
			}),
			sendEmail: async () => {
				throw new Error("smtp down");
			},
		});
		expect((await getCreditRefill(db, id)).belowUsdMicros).toBeNull();
	});
});
