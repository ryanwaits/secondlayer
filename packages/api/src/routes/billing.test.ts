import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import type Stripe from "stripe";
import {
	type StripeClient,
	ensureStripeCustomer,
	isResourceMissing,
} from "./billing.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const db = getDb();

// Track seeded account ids for cleanup
const seededAccountIds: string[] = [];

async function makeAccount(
	email: string,
	stripeCustomerId?: string,
): Promise<Awaited<ReturnType<typeof getAccountRow>>> {
	const row = await db
		.insertInto("accounts")
		.values({ email, stripe_customer_id: stripeCustomerId ?? null })
		.returningAll()
		.executeTakeFirstOrThrow();
	seededAccountIds.push(row.id);
	return row;
}

// Re-select through the same query shape `ensureStripeCustomer` callers use,
// so the fixture matches the `AccountRow` type exactly.
async function getAccountRow(email: string) {
	return db
		.selectFrom("accounts")
		.selectAll()
		.where("email", "=", email)
		.executeTakeFirstOrThrow();
}

afterAll(async () => {
	for (const id of seededAccountIds) {
		await db.deleteFrom("accounts").where("id", "=", id).execute();
	}
});

/** Build a stub Stripe client implementing only what `ensureStripeCustomer`
 * calls, with call counters so double-create regressions are caught. */
function makeStubStripe(opts: {
	retrieve: (id: string) => Promise<unknown>;
	createdCustomerId: string;
}): { stripe: StripeClient; calls: { retrieve: number; create: number } } {
	const calls = { retrieve: 0, create: 0 };
	const stripe = {
		customers: {
			retrieve: async (id: string) => {
				calls.retrieve++;
				return opts.retrieve(id);
			},
			create: async (_params: unknown) => {
				calls.create++;
				return { id: opts.createdCustomerId } as unknown as Stripe.Customer;
			},
		},
	} as unknown as StripeClient;
	return { stripe, calls };
}

describe("isResourceMissing", () => {
	test("matches Stripe's resource_missing code", () => {
		expect(isResourceMissing({ code: "resource_missing" })).toBe(true);
	});

	test("does not match a different error code", () => {
		expect(isResourceMissing({ code: "rate_limit" })).toBe(false);
	});

	test("does not match a plain Error with no code", () => {
		expect(isResourceMissing(new Error("boom"))).toBe(false);
	});

	test("does not match null/undefined/primitives", () => {
		expect(isResourceMissing(null)).toBe(false);
		expect(isResourceMissing(undefined)).toBe(false);
		expect(isResourceMissing("resource_missing")).toBe(false);
	});
});

describe("ensureStripeCustomer", () => {
	test("new customer: no stored id -> creates once and persists it", async () => {
		if (!HAS_DB) return;

		const email = `billing-test-new-${Date.now()}@test.invalid`;
		await makeAccount(email);
		const account = await getAccountRow(email);
		expect(account.stripe_customer_id).toBeNull();

		const { stripe, calls } = makeStubStripe({
			retrieve: async () => {
				throw new Error("should not be called — no stored id");
			},
			createdCustomerId: "cus_new_123",
		});

		const id = await ensureStripeCustomer(stripe, db, account);

		expect(id).toBe("cus_new_123");
		expect(calls.retrieve).toBe(0);
		expect(calls.create).toBe(1);

		const persisted = await getAccountRow(email);
		expect(persisted.stripe_customer_id).toBe("cus_new_123");
	});

	test("existing valid customer: reuses it, never creates", async () => {
		if (!HAS_DB) return;

		const email = `billing-test-valid-${Date.now()}@test.invalid`;
		await makeAccount(email, "cus_existing_valid");
		const account = await getAccountRow(email);

		const { stripe, calls } = makeStubStripe({
			retrieve: async (id) => {
				expect(id).toBe("cus_existing_valid");
				return { id, deleted: false } as unknown as Stripe.Customer;
			},
			createdCustomerId: "cus_should_not_be_created",
		});

		const id = await ensureStripeCustomer(stripe, db, account);

		expect(id).toBe("cus_existing_valid");
		expect(calls.retrieve).toBe(1);
		expect(calls.create).toBe(0);

		const persisted = await getAccountRow(email);
		expect(persisted.stripe_customer_id).toBe("cus_existing_valid");
	});

	test("existing-but-missing (retrieve throws resource_missing): recreates once", async () => {
		if (!HAS_DB) return;

		const email = `billing-test-missing-throw-${Date.now()}@test.invalid`;
		await makeAccount(email, "cus_stale_throws");
		const account = await getAccountRow(email);

		const { stripe, calls } = makeStubStripe({
			retrieve: async () => {
				const err = new Error("No such customer") as Error & {
					code: string;
				};
				err.code = "resource_missing";
				throw err;
			},
			createdCustomerId: "cus_recreated_via_throw",
		});

		const id = await ensureStripeCustomer(stripe, db, account);

		expect(id).toBe("cus_recreated_via_throw");
		expect(calls.retrieve).toBe(1);
		expect(calls.create).toBe(1);

		const persisted = await getAccountRow(email);
		expect(persisted.stripe_customer_id).toBe("cus_recreated_via_throw");
	});

	test("existing-but-deleted (retrieve resolves { deleted: true }): recreates once, no throw path", async () => {
		if (!HAS_DB) return;

		const email = `billing-test-missing-deleted-${Date.now()}@test.invalid`;
		await makeAccount(email, "cus_stale_deleted");
		const account = await getAccountRow(email);

		const { stripe, calls } = makeStubStripe({
			retrieve: async (id) =>
				({ id, deleted: true }) as unknown as Stripe.Customer,
			createdCustomerId: "cus_recreated_via_deleted",
		});

		const id = await ensureStripeCustomer(stripe, db, account);

		expect(id).toBe("cus_recreated_via_deleted");
		expect(calls.retrieve).toBe(1);
		expect(calls.create).toBe(1);

		const persisted = await getAccountRow(email);
		expect(persisted.stripe_customer_id).toBe("cus_recreated_via_deleted");
	});

	test("propagates a non-resource_missing retrieve error without creating", async () => {
		if (!HAS_DB) return;

		const email = `billing-test-other-error-${Date.now()}@test.invalid`;
		await makeAccount(email, "cus_other_error");
		const account = await getAccountRow(email);

		const { stripe, calls } = makeStubStripe({
			retrieve: async () => {
				const err = new Error("rate limited") as Error & { code: string };
				err.code = "rate_limit";
				throw err;
			},
			createdCustomerId: "cus_should_not_be_created",
		});

		await expect(ensureStripeCustomer(stripe, db, account)).rejects.toThrow(
			"rate limited",
		);
		expect(calls.retrieve).toBe(1);
		expect(calls.create).toBe(0);

		const persisted = await getAccountRow(email);
		expect(persisted.stripe_customer_id).toBe("cus_other_error");
	});
});
