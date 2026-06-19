import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	creditCredits,
	getCredits,
	getMonthlyCreditsSpend,
	recordCreditsSpend,
} from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import {
	COMMIT_TIER_MONTHLY_USD_MICROS,
	CREDIT_USD_MICROS_PER_ROW,
	CREDIT_USD_MICROS_PER_ROW_VOLUME,
	debitCreditedRows,
	isOverMonthlyCreditCap,
} from "./read-credits.ts";

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

describe("debitCreditedRows (DB)", () => {
	const TEST_EMAIL = `read-credits-test-${Date.now()}@example.com`;
	let accountId: string;
	const db = getDb();

	beforeAll(async () => {
		if (!HAS_DB) return;
		const row = await db
			.insertInto("accounts")
			.values({ email: TEST_EMAIL })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountId = row.id;
	});

	afterAll(async () => {
		if (!HAS_DB) return;
		await db
			.deleteFrom("account_credits")
			.where("account_id", "=", accountId)
			.execute();
		await db.deleteFrom("accounts").where("id", "=", accountId).execute();
	});

	test("debit and record move together (standard rate)", async () => {
		if (!HAS_DB) return;

		await db
			.deleteFrom("account_credits")
			.where("account_id", "=", accountId)
			.execute();

		await creditCredits(db, accountId, 1_000_000n);

		const rows = 10;
		const expectedCost = BigInt(rows) * CREDIT_USD_MICROS_PER_ROW; // 10 × 5 = 50

		await debitCreditedRows({ accountId, balance: 1_000_000n }, rows);

		const balanceAfter = await getCredits(db, accountId);
		const spendAfter = await getMonthlyCreditsSpend(db, accountId);

		expect(balanceAfter).toBe(1_000_000n - expectedCost);
		expect(spendAfter).toBe(expectedCost);
	});

	test("insufficient balance: neither balance nor spend changes", async () => {
		if (!HAS_DB) return;

		await db
			.deleteFrom("account_credits")
			.where("account_id", "=", accountId)
			.execute();

		// Credit only 3n — below one row's cost of 5n
		await creditCredits(db, accountId, 3n);

		await debitCreditedRows({ accountId, balance: 3n }, 1);

		const balanceAfter = await getCredits(db, accountId);
		const spendAfter = await getMonthlyCreditsSpend(db, accountId);

		expect(balanceAfter).toBe(3n);
		expect(spendAfter).toBe(0n);
	});

	test("volume rate applies past commit threshold", async () => {
		if (!HAS_DB) return;

		await db
			.deleteFrom("account_credits")
			.where("account_id", "=", accountId)
			.execute();

		// Pre-seed monthly spend at the threshold
		await recordCreditsSpend(db, accountId, COMMIT_TIER_MONTHLY_USD_MICROS);

		// Credit enough balance for 10 rows at volume rate (10 × 2 = 20)
		await creditCredits(db, accountId, 1_000_000n);

		const rows = 10;
		const expectedCost = BigInt(rows) * CREDIT_USD_MICROS_PER_ROW_VOLUME; // 10 × 2 = 20

		await debitCreditedRows({ accountId, balance: 1_000_000n }, rows);

		const balanceAfter = await getCredits(db, accountId);
		const spendAfter = await getMonthlyCreditsSpend(db, accountId);

		expect(balanceAfter).toBe(1_000_000n - expectedCost);
		// Spend = pre-seeded threshold + new cost
		expect(spendAfter).toBe(COMMIT_TIER_MONTHLY_USD_MICROS + expectedCost);
	});
});
