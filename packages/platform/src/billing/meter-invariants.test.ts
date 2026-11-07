import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import {
	creditCredits,
	getMonthlyCreditsSpend,
} from "../db/queries/account-credits.ts";
import { upsertCaps } from "../db/queries/account-spend-caps.ts";
import { meter } from "./meter.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const accountIds: string[] = [];
let accountId: string;

beforeEach(async () => {
	if (!HAS_DB) return;
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: true })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountId = row.id;
	accountIds.push(row.id);
});

afterEach(async () => {
	if (!HAS_DB) return;
	for (const table of [
		"usage_ledger",
		"account_credits",
		"account_spend_caps",
	] as const) {
		await db.deleteFrom(table).where("account_id", "=", accountId).execute();
	}
});

afterAll(async () => {
	if (!HAS_DB || accountIds.length === 0) return;
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

function lastMonth(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
}

function partition(quantity: number, occurredAt?: Date) {
	return meter(db, {
		accountId,
		unit: "archive.partition",
		quantity,
		source: "test",
		idempotencyKey: randomUUID(),
		occurredAt,
	});
}

describe.skipIf(!HAS_DB)("meter — monthly spend counter", () => {
	test("a late item from last month leaves this month's spend intact", async () => {
		await creditCredits(db, accountId, 10_000_000n);

		await partition(1);
		expect(await getMonthlyCreditsSpend(db, accountId)).toBe(50_000n);

		// Late item: priced and debited, counted in the month it is taken.
		await partition(2, lastMonth());
		expect(await getMonthlyCreditsSpend(db, accountId)).toBe(150_000n);

		// The next current-month charge keeps accumulating, never resets.
		await partition(1);
		expect(await getMonthlyCreditsSpend(db, accountId)).toBe(200_000n);
	});

	test("the spend cap still holds after a late item from last month", async () => {
		await creditCredits(db, accountId, 10_000_000n);
		// 10 cents = 100_000 µ$: two partitions reach it.
		await upsertCaps(db, accountId, { monthly_cap_cents: 10 });
		await partition(1);
		await partition(1);
		await partition(1, lastMonth());

		const after = await partition(1);
		expect(after.debitedUsdMicros).toBe(0n);
		expect(after.debited).toBe(false);
		expect(await getMonthlyCreditsSpend(db, accountId)).toBe(100_000n);
	});
});
