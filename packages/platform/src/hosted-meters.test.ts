import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { creditCredits, getCredits } from "./db/queries/account-credits.ts";
import {
	RUNNING_USD_MICROS_PER_DAY,
	debitHostedMeter,
	deliveryCost,
	indexingCost,
	storageDailyCost,
} from "./hosted-meters.ts";

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

describe("hosted meter prices", () => {
	test("indexingCost", () => {
		expect(indexingCost(0)).toBe(0n);
		expect(indexingCost(8_700_000)).toBe(8_700_000n);
	});

	test("deliveryCost", () => {
		expect(deliveryCost(1)).toBe(100n);
		expect(deliveryCost(10_000)).toBe(1_000_000n);
	});

	test("storageDailyCost", () => {
		expect(storageDailyCost(0n)).toBe(0n);
		expect(storageDailyCost(1_000_000_000n)).toBe(16_666n);
	});

	test("running fee is $3 per 30-day month", () => {
		expect(RUNNING_USD_MICROS_PER_DAY * 30n).toBe(3_000_000n);
	});
});

describe.skipIf(!HAS_DB)("debitHostedMeter", () => {
	test("debits on success and refuses overdraw", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		expect(await debitHostedMeter(db, accountId, 100n)).toBe(true);
		expect(await getCredits(db, accountId)).toBe(999_900n);

		expect(await debitHostedMeter(db, accountId, 2_000_000n)).toBe(false);
		expect(await getCredits(db, accountId)).toBe(999_900n);
	});
});
