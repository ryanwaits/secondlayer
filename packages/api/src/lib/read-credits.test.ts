import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	ROWS_DELIVERED_MONTHLY_ALLOWANCE,
	isOverMonthlyCreditCap,
} from "@secondlayer/platform/billing/prices";
import {
	creditCredits,
	getCredits,
} from "@secondlayer/platform/db/queries/account-credits";
import { upsertCaps } from "@secondlayer/platform/db/queries/account-spend-caps";
import { getDb } from "@secondlayer/shared/db";
import { checkRowsAllowance, meterRowsDelivered } from "./read-credits.ts";

const HAS_DB = !!process.env.DATABASE_URL;

describe("isOverMonthlyCreditCap", () => {
	test("no cap (null) is never over", () => {
		expect(isOverMonthlyCreditCap(0n, null)).toBe(false);
		expect(isOverMonthlyCreditCap(999_999_999n, null)).toBe(false);
	});

	test("under the cap → not over", () => {
		// $5.00 cap = 500¢ = 5_000_000 µ$. Spent $4.99.
		expect(isOverMonthlyCreditCap(4_990_000n, 500)).toBe(false);
	});

	test("exactly at the cap → over (freeze on reach, inclusive)", () => {
		expect(isOverMonthlyCreditCap(5_000_000n, 500)).toBe(true);
	});

	test("over the cap → over", () => {
		expect(isOverMonthlyCreditCap(5_000_001n, 500)).toBe(true);
	});

	test("zero cap freezes immediately on any spend", () => {
		expect(isOverMonthlyCreditCap(0n, 0)).toBe(true);
		expect(isOverMonthlyCreditCap(1n, 0)).toBe(true);
	});

	test("cents→micros conversion is 10_000× (1¢ = 10_000 µ$)", () => {
		// 1¢ cap = 10_000 µ$. Spending 9_999 µ$ is under; 10_000 is at.
		expect(isOverMonthlyCreditCap(9_999n, 1)).toBe(false);
		expect(isOverMonthlyCreditCap(10_000n, 1)).toBe(true);
	});
});

// The dollar-per-row math (5µ$ standard, 2µ$ volume, allowance boundary,
// idempotent replay, short-balance visibility) is characterized against
// `meter()` directly in packages/platform/src/billing/meter.test.ts —
// `meterRowsDelivered` here is a thin `meter()` call, so this just pins
// that it reaches the ledger at all and is a no-op for an empty page.
describe.skipIf(!HAS_DB)("meterRowsDelivered (DB)", () => {
	const TEST_EMAIL = `read-credits-test-${Date.now()}@example.com`;
	let accountId: string;
	const db = HAS_DB ? getDb() : (null as never);

	beforeAll(async () => {
		const row = await db
			.insertInto("accounts")
			.values({ email: TEST_EMAIL })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountId = row.id;
	});

	afterAll(async () => {
		await db
			.deleteFrom("account_credits")
			.where("account_id", "=", accountId)
			.execute();
		await db.deleteFrom("accounts").where("id", "=", accountId).execute();
	});

	test("zero rows is a no-op — no ledger row, no debit", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const before = await getCredits(db, accountId);
		await meterRowsDelivered(accountId, 0, "test");
		expect(await getCredits(db, accountId)).toBe(before);
	});

	test("a page of rows reaches the ledger", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		await meterRowsDelivered(accountId, 5, "test");
		const rows = await db
			.selectFrom("usage_ledger")
			.select("unit")
			.where("account_id", "=", accountId)
			.where("unit", "=", "rows.delivered")
			.execute();
		expect(rows.length).toBeGreaterThan(0);
	});
});

describe.skipIf(!HAS_DB)(
	"checkRowsAllowance — spend cap enforcement (DB)",
	() => {
		const db = HAS_DB ? getDb() : (null as never);
		const ids: string[] = [];
		let prevMode: string | undefined;

		beforeAll(() => {
			prevMode = process.env.INSTANCE_MODE;
			process.env.INSTANCE_MODE = "platform";
		});

		afterAll(async () => {
			if (prevMode === undefined) delete process.env.INSTANCE_MODE;
			else process.env.INSTANCE_MODE = prevMode;
			if (ids.length === 0) return;
			await db
				.deleteFrom("account_spend_caps")
				.where("account_id", "in", ids)
				.execute();
			await db
				.deleteFrom("usage_ledger")
				.where("account_id", "in", ids)
				.execute();
			await db
				.deleteFrom("account_credits")
				.where("account_id", "in", ids)
				.execute();
			await db.deleteFrom("accounts").where("id", "in", ids).execute();
		});

		/** A fresh account, $1.00 balance (well over MIN_CREDITED_USD_MICROS) so
		 *  the cap — not the balance — is what's under test. */
		async function makeAccount(): Promise<string> {
			const row = await db
				.insertInto("accounts")
				.values({
					email: `read-credits-cap-${crypto.randomUUID().slice(0, 8)}@example.com`,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			ids.push(row.id);
			await creditCredits(db, row.id, 1_000_000n);
			return row.id;
		}

		test("under cap, past the free rows, with balance → served (null)", async () => {
			const id = await makeAccount();
			await meterRowsDelivered(id, ROWS_DELIVERED_MONTHLY_ALLOWANCE, "test");
			await upsertCaps(db, id, { monthly_cap_cents: 10_000 }); // $100 cap, $0 spent
			expect(await checkRowsAllowance(id, "free")).toBeNull();
		});

		test("over cap but still inside the free rows → served (cap can't apply yet)", async () => {
			const id = await makeAccount();
			await upsertCaps(db, id, { monthly_cap_cents: 0 }); // $0 cap trips on any spend
			expect(await checkRowsAllowance(id, "free")).toBeNull();
		});

		test("over cap and past the free rows → 402 spend_cap_reached", async () => {
			const id = await makeAccount();
			await meterRowsDelivered(id, ROWS_DELIVERED_MONTHLY_ALLOWANCE, "test");
			await upsertCaps(db, id, { monthly_cap_cents: 0 }); // $0 cap, any spend trips it
			const refusal = await checkRowsAllowance(id, "free");
			expect(refusal?.error).toBe("spend_cap_reached");
			if (refusal?.error === "spend_cap_reached") {
				expect(refusal.message).toContain("monthly spend cap");
				expect(refusal.message).toContain("account/credits#cap");
			}
		});

		test("internal tier is never capped, even over cap and past the free rows", async () => {
			const id = await makeAccount();
			await meterRowsDelivered(id, ROWS_DELIVERED_MONTHLY_ALLOWANCE, "test");
			await upsertCaps(db, id, { monthly_cap_cents: 0 });
			expect(await checkRowsAllowance(id, "internal")).toBeNull();
		});

		test("raising the cap re-allows the read", async () => {
			const id = await makeAccount();
			await meterRowsDelivered(id, ROWS_DELIVERED_MONTHLY_ALLOWANCE, "test");
			await upsertCaps(db, id, { monthly_cap_cents: 0 });
			expect((await checkRowsAllowance(id, "free"))?.error).toBe(
				"spend_cap_reached",
			);
			await upsertCaps(db, id, { monthly_cap_cents: 10_000 }); // raise to $100
			expect(await checkRowsAllowance(id, "free")).toBeNull();
		});
	},
);
