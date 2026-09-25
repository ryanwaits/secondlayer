import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isOverMonthlyCreditCap } from "@secondlayer/platform/billing/prices";
import {
	creditCredits,
	getCredits,
} from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import { meterRowsDelivered } from "./read-credits.ts";

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
