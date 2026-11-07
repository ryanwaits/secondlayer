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
	getCredits,
	getMonthlyCreditsSpend,
} from "../db/queries/account-credits.ts";
import { upsertCaps } from "../db/queries/account-spend-caps.ts";
import { burnRateUsdMicros } from "../db/queries/usage-ledger.ts";
import { grantCredits, meter, recordRefund, recordTopup } from "./meter.ts";
import { PRICES } from "./prices.ts";

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

describe.skipIf(!HAS_DB)("meter — concurrent charges for one account", () => {
	test("20 concurrent row pages straddling the allowance bill exactly the excess", async () => {
		await creditCredits(db, accountId, 100_000_000n);
		const now = new Date();
		// 20 x 100k rows = 2M; the first 1M are free, the other 1M cost 5 µ$ each.
		await Promise.all(
			Array.from({ length: 20 }, () =>
				meter(db, {
					accountId,
					unit: "rows.delivered",
					quantity: 100_000,
					source: "test",
					idempotencyKey: randomUUID(),
					occurredAt: now,
				}),
			),
		);
		const rows = await db
			.selectFrom("usage_ledger")
			.select(["usd_micros", "debited_usd_micros"])
			.where("account_id", "=", accountId)
			.execute();
		const priced = rows.reduce((sum, r) => sum + BigInt(r.usd_micros), 0n);
		const taken = rows.reduce(
			(sum, r) => sum + BigInt(r.debited_usd_micros),
			0n,
		);
		expect(priced).toBe(5_000_000n);
		expect(taken).toBe(5_000_000n);
		expect(await getMonthlyCreditsSpend(db, accountId)).toBe(5_000_000n);
		expect(await getCredits(db, accountId)).toBe(95_000_000n);
	});

	test("20 concurrent charges against a spend cap take only what the cap allows", async () => {
		await creditCredits(db, accountId, 100_000_000n);
		// 10 cents = 100_000 µ$: exactly two 50_000 µ$ partitions fit.
		await upsertCaps(db, accountId, { monthly_cap_cents: 10 });
		const results = await Promise.all(
			Array.from({ length: 20 }, () => partition(1)),
		);
		expect(results.filter((r) => r.debited)).toHaveLength(2);
		expect(await getMonthlyCreditsSpend(db, accountId)).toBe(100_000n);
		expect(await getCredits(db, accountId)).toBe(99_900_000n);
	});
});

describe.skipIf(!HAS_DB)("top-up and grant quantity", () => {
	test("a top-up with cents keeps them in quantity and moves the exact micros", async () => {
		const key = randomUUID();
		const { balance } = await recordTopup(db, {
			accountId,
			usdMicros: 12_340_000n,
			source: "test",
			idempotencyKey: key,
		});
		expect(balance).toBe(12_340_000n);
		const row = await db
			.selectFrom("usage_ledger")
			.select(["quantity", "usd_micros"])
			.where("idempotency_key", "=", key)
			.executeTakeFirstOrThrow();
		expect(Number(row.quantity)).toBe(12.34);
		expect(BigInt(row.usd_micros)).toBe(-12_340_000n);
	});

	test("a grant under one dollar is not stored as zero quantity", async () => {
		const key = randomUUID();
		await grantCredits(db, {
			accountId,
			usdMicros: 500_000n,
			source: "test",
			idempotencyKey: key,
		});
		const row = await db
			.selectFrom("usage_ledger")
			.select(["quantity", "usd_micros"])
			.where("idempotency_key", "=", key)
			.executeTakeFirstOrThrow();
		expect(Number(row.quantity)).toBe(0.5);
		expect(BigInt(row.usd_micros)).toBe(-500_000n);
		expect(await getCredits(db, accountId)).toBe(500_000n);
	});
});

describe.skipIf(!HAS_DB)("ledger shape", () => {
	function insertLedger(unit: string, quantity: number, usdMicros: bigint) {
		return db
			.insertInto("usage_ledger")
			.values({
				account_id: accountId,
				unit,
				quantity,
				usd_micros: usdMicros.toString(),
				debited_usd_micros: usdMicros.toString(),
				source: "test",
				idempotency_key: randomUUID(),
			})
			.execute();
	}

	test("every priced unit, top-up, grant and refund is accepted with its own sign", async () => {
		for (const unit of Object.keys(PRICES)) {
			await insertLedger(unit, 1, 50_000n);
		}
		await insertLedger("topup", 5, -5_000_000n);
		await insertLedger("grant", 5, -5_000_000n);
		await insertLedger("refund", 5, 5_000_000n);
		await insertLedger("rows.delivered", 0, 0n);
		const count = await db
			.selectFrom("usage_ledger")
			.select((eb) => eb.fn.countAll<string>().as("n"))
			.where("account_id", "=", accountId)
			.executeTakeFirstOrThrow();
		expect(Number(count.n)).toBe(Object.keys(PRICES).length + 4);
	});

	test("the ledger refuses an unknown unit", async () => {
		await expect(insertLedger("mystery.unit", 1, 10n)).rejects.toThrow(
			/usage_ledger_unit_check/,
		);
	});

	test("the ledger refuses a negative quantity", async () => {
		await expect(insertLedger("archive.partition", -1, 0n)).rejects.toThrow(
			/usage_ledger_quantity_nonnegative_check/,
		);
	});

	test("the ledger refuses a negative charge and a positive top-up or grant", async () => {
		await expect(
			insertLedger("archive.partition", 1, -50_000n),
		).rejects.toThrow(/usage_ledger_usd_micros_sign_check/);
		await expect(insertLedger("topup", 1, 1_000_000n)).rejects.toThrow(
			/usage_ledger_usd_micros_sign_check/,
		);
		await expect(insertLedger("grant", 1, 1_000_000n)).rejects.toThrow(
			/usage_ledger_usd_micros_sign_check/,
		);
		await expect(insertLedger("refund", 1, -1_000_000n)).rejects.toThrow(
			/usage_ledger_usd_micros_sign_check/,
		);
	});

	test("meter refuses a negative quantity and leaves balance and ledger untouched", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		await expect(
			meter(db, {
				accountId,
				unit: "memory.gb_hour",
				quantity: -2,
				source: "test",
				idempotencyKey: randomUUID(),
			}),
		).rejects.toThrow(/quantity/);
		expect(await getCredits(db, accountId)).toBe(1_000_000n);
		const rows = await db
			.selectFrom("usage_ledger")
			.select("id")
			.where("account_id", "=", accountId)
			.execute();
		expect(rows).toHaveLength(0);
	});

	test("meter refuses a non-finite quantity and an unknown unit", async () => {
		for (const [unit, quantity] of [
			["archive.partition", Number.NaN],
			["archive.partition", Number.POSITIVE_INFINITY],
			["not.a.unit", 1],
		] as const) {
			await expect(
				meter(db, {
					accountId,
					unit: unit as "archive.partition",
					quantity,
					source: "test",
					idempotencyKey: randomUUID(),
				}),
			).rejects.toThrow();
		}
	});
});

describe.skipIf(!HAS_DB)("recordRefund", () => {
	test("takes at most the balance, keeps the full amount on the row, and is not spend", async () => {
		await creditCredits(db, accountId, 3_000_000n);
		const key = randomUUID();
		const result = await recordRefund(db, {
			accountId,
			usdMicros: 5_000_000n,
			source: "test",
			idempotencyKey: key,
		});
		expect(result).toEqual({
			claimed: true,
			takenUsdMicros: 3_000_000n,
			balance: 0n,
		});
		const row = await db
			.selectFrom("usage_ledger")
			.select(["unit", "usd_micros", "debited_usd_micros", "debited"])
			.where("idempotency_key", "=", key)
			.executeTakeFirstOrThrow();
		expect(row).toEqual({
			unit: "refund",
			usd_micros: "5000000",
			debited_usd_micros: "3000000",
			debited: false,
		});
		// Money out, not usage: no spend, no burn rate.
		expect(await getMonthlyCreditsSpend(db, accountId)).toBe(0n);
		expect(await burnRateUsdMicros(db, accountId)).toBe(0n);

		const replay = await recordRefund(db, {
			accountId,
			usdMicros: 5_000_000n,
			source: "test",
			idempotencyKey: key,
		});
		expect(replay.claimed).toBe(false);
		expect(replay.takenUsdMicros).toBe(3_000_000n);
	});

	test("refuses a non-positive amount", async () => {
		await expect(
			recordRefund(db, {
				accountId,
				usdMicros: 0n,
				source: "test",
				idempotencyKey: randomUUID(),
			}),
		).rejects.toThrow(/refund must be positive/);
	});
});
