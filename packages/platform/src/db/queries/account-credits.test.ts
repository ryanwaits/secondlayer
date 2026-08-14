import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	creditCredits,
	debitCredits,
	getCreditRefill,
	getCredits,
	getMonthlyCreditsSpend,
	recordCreditsSpend,
	setCreditRefill,
} from "./account-credits.ts";

const HAS_DB = !!process.env.DATABASE_URL;

const db = HAS_DB ? getDb() : (null as never);

const accountIds: string[] = [];

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({
			email: null,
			ghost: true,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

let accountId: string;

beforeEach(async () => {
	if (!HAS_DB) return;
	accountId = await makeAccount();
});

afterEach(async () => {
	if (!HAS_DB) return;
	if (accountId) {
		await db
			.deleteFrom("account_credits")
			.where("account_id", "=", accountId)
			.execute();
	}
});

afterAll(async () => {
	if (!HAS_DB) return;
	if (accountIds.length > 0) {
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

describe.skipIf(!HAS_DB)("creditCredits / getCredits", () => {
	test("balance accumulates across two credits", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const after = await creditCredits(db, accountId, 500_000n);
		expect(after).toBe(1_500_000n);
		expect(await getCredits(db, accountId)).toBe(1_500_000n);
	});
});

describe.skipIf(!HAS_DB)("debitCredits", () => {
	test("refuses overdraw and leaves balance unchanged", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const refused = await debitCredits(db, accountId, 1_500_000n);
		expect(refused.ok).toBe(false);
		expect(await getCredits(db, accountId)).toBe(1_000_000n);
	});

	test("succeeds and returns correct remaining balance", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const result = await debitCredits(db, accountId, 400_000n);
		expect(result.ok).toBe(true);
		expect(result.remaining).toBe(600_000n);
	});
});

describe.skipIf(!HAS_DB)("recordCreditsSpend / getMonthlyCreditsSpend", () => {
	test("accumulates spend within same month", async () => {
		const fixedNow = new Date("2026-06-01T12:00:00Z");
		await recordCreditsSpend(db, accountId, 5_000n, fixedNow);
		await recordCreditsSpend(db, accountId, 5_000n, fixedNow);
		const spent = await getMonthlyCreditsSpend(db, accountId, fixedNow);
		expect(spent).toBe(10_000n);
	});

	test("month rollover returns 0", async () => {
		const thisMonth = new Date("2026-06-01T12:00:00Z");
		const nextMonth = new Date("2026-07-01T12:00:00Z");
		await recordCreditsSpend(db, accountId, 9_000n, thisMonth);
		const spent = await getMonthlyCreditsSpend(db, accountId, nextMonth);
		expect(spent).toBe(0n);
	});
});

describe.skipIf(!HAS_DB)("credit refill settings", () => {
	test("defaults off and can be enabled then cleared", async () => {
		expect(await getCreditRefill(db, accountId)).toEqual({
			belowUsdMicros: null,
			packUsd: null,
			lastAt: null,
		});
		const on = await setCreditRefill(db, accountId, {
			belowUsdMicros: 5_000_000n,
			packUsd: 25,
		});
		expect(on.belowUsdMicros).toBe(5_000_000n);
		expect(on.packUsd).toBe(25);
		const off = await setCreditRefill(db, accountId, {
			belowUsdMicros: null,
			packUsd: null,
		});
		expect(off.belowUsdMicros).toBeNull();
		expect(off.packUsd).toBeNull();
	});
});
