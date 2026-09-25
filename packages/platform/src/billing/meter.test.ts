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
import { meter } from "./meter.ts";
import {
	COMMIT_TIER_MONTHLY_USD_MICROS,
	CREDIT_USD_MICROS_PER_ROW,
	CREDIT_USD_MICROS_PER_ROW_VOLUME,
	ROWS_DELIVERED_MONTHLY_ALLOWANCE,
} from "./prices.ts";

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

let accountId: string;

beforeEach(async () => {
	if (!HAS_DB) return;
	accountId = await makeAccount();
});

afterEach(async () => {
	if (!HAS_DB) return;
	await db
		.deleteFrom("usage_ledger")
		.where("account_id", "=", accountId)
		.execute();
	await db
		.deleteFrom("account_credits")
		.where("account_id", "=", accountId)
		.execute();
	await db
		.deleteFrom("account_spend_caps")
		.where("account_id", "=", accountId)
		.execute();
});

afterAll(async () => {
	if (!HAS_DB) return;
	if (accountIds.length > 0) {
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

describe.skipIf(!HAS_DB)("meter — rows.delivered characterization", () => {
	// Pins the exact $ amounts `debitCreditedRows` charged before plan-049
	// (packages/api/src/lib/read-credits.test.ts, pre-refactor): 5µ$/row
	// standard, 2µ$/row past the $50/mo commit tier. Allowance replaces the
	// old free-height-window, but once past the allowance these amounts must
	// not change.
	test("standard rate: 10 rows past the allowance cost 10 x 5µ$", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const now = new Date("2026-09-24T00:00:00Z");
		await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE,
			source: "test",
			idempotencyKey: randomUUID(),
			occurredAt: now,
		});
		const result = await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: 10,
			source: "test",
			idempotencyKey: randomUUID(),
			occurredAt: now,
		});
		const expectedCost = 10n * CREDIT_USD_MICROS_PER_ROW;
		expect(result.usdMicros).toBe(expectedCost);
		expect(result.debited).toBe(true);
		expect(await getCredits(db, accountId)).toBe(1_000_000n - expectedCost);
		expect(await getMonthlyCreditsSpend(db, accountId)).toBe(expectedCost);
	});

	test("volume rate applies once this month's spend reaches the commit tier", async () => {
		// Enough balance to cover 25M billable rows at the base rate ($125).
		await creditCredits(db, accountId, 200_000_000n);
		// Pre-seed the ledger past the commit threshold entirely via the
		// allowance-exhausting path so getMonthlyCreditsSpend reads the tier.
		const now = new Date("2026-09-24T00:00:00Z");
		await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE + 25_000_000, // forces spend well past $50
			source: "test",
			idempotencyKey: randomUUID(),
			occurredAt: now,
		});
		const spentSoFar = await getMonthlyCreditsSpend(db, accountId);
		expect(spentSoFar).toBeGreaterThanOrEqual(COMMIT_TIER_MONTHLY_USD_MICROS);

		const result = await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: 10,
			source: "test",
			idempotencyKey: randomUUID(),
			occurredAt: now,
		});
		const expectedCost = 10n * CREDIT_USD_MICROS_PER_ROW_VOLUME;
		expect(result.usdMicros).toBe(expectedCost);
	});

	test("allowance boundary: row 10,000,000 free, 10,000,001st charged", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const now = new Date("2026-09-24T00:00:00Z");
		const atBoundary = await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE,
			source: "test",
			idempotencyKey: randomUUID(),
			occurredAt: now,
		});
		expect(atBoundary.usdMicros).toBe(0n);
		expect(atBoundary.viaAllowance).toBe(true);

		const pastBoundary = await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: 1,
			source: "test",
			idempotencyKey: randomUUID(),
			occurredAt: now,
		});
		expect(pastBoundary.usdMicros).toBe(CREDIT_USD_MICROS_PER_ROW);
		expect(pastBoundary.viaAllowance).toBe(false);
	});

	test("a batch straddling the allowance boundary is charged only for the excess", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const now = new Date("2026-09-24T00:00:00Z");
		// Use up all but 5 rows of the allowance.
		await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE - 5,
			source: "test",
			idempotencyKey: randomUUID(),
			occurredAt: now,
		});
		// A batch of 20 rows: 5 free, 15 billable.
		const result = await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: 20,
			source: "test",
			idempotencyKey: randomUUID(),
			occurredAt: now,
		});
		expect(result.usdMicros).toBe(15n * CREDIT_USD_MICROS_PER_ROW);
	});

	test("short balance: ledger row written with debited=false, balance unchanged", async () => {
		// No credits — balance is 0, and the allowance is already exhausted.
		const now = new Date("2026-09-24T00:00:00Z");
		await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE,
			source: "test",
			idempotencyKey: randomUUID(),
			occurredAt: now,
		});
		const result = await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: 10,
			source: "test",
			idempotencyKey: randomUUID(),
			occurredAt: now,
		});
		expect(result.debited).toBe(false);
		expect(result.usdMicros).toBe(10n * CREDIT_USD_MICROS_PER_ROW);
		expect(await getCredits(db, accountId)).toBe(0n);

		const row = await db
			.selectFrom("usage_ledger")
			.selectAll()
			.where("id", "=", result.ledgerId)
			.executeTakeFirstOrThrow();
		expect(row.debited).toBe(false);
	});

	test("spend cap refuses the debit even with balance available", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		await upsertCaps(db, accountId, { monthly_cap_cents: 0 });
		const now = new Date("2026-09-24T00:00:00Z");
		const result = await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE + 10,
			source: "test",
			idempotencyKey: randomUUID(),
			occurredAt: now,
		});
		expect(result.debited).toBe(false);
		expect(await getCredits(db, accountId)).toBe(1_000_000n);
	});

	test("idempotent replay: the same key never charges twice", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const now = new Date("2026-09-24T00:00:00Z");
		const key = randomUUID();
		const first = await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE + 10,
			source: "test",
			idempotencyKey: key,
			occurredAt: now,
		});
		const balanceAfterFirst = await getCredits(db, accountId);
		expect(first.usdMicros).toBe(10n * CREDIT_USD_MICROS_PER_ROW);

		const replay = await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: ROWS_DELIVERED_MONTHLY_ALLOWANCE + 10,
			source: "test",
			idempotencyKey: key,
			occurredAt: now,
		});
		expect(replay.ledgerId).toBe(first.ledgerId);
		expect(replay.usdMicros).toBe(first.usdMicros);
		expect(await getCredits(db, accountId)).toBe(balanceAfterFirst);

		const rows = await db
			.selectFrom("usage_ledger")
			.select("id")
			.where("idempotency_key", "=", key)
			.execute();
		expect(rows).toHaveLength(1);
	});
});

describe.skipIf(!HAS_DB)("meter — flat-priced units (archive)", () => {
	test("archive.partition prices at $0.05 per partition, unaffected by allowance", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const result = await meter(db, {
			accountId,
			unit: "archive.partition",
			quantity: 1,
			source: "archive",
			idempotencyKey: randomUUID(),
		});
		expect(result.usdMicros).toBe(50_000n);
		expect(result.debited).toBe(true);
	});

	test("archive.partition.events prices at $0.15 per partition", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const result = await meter(db, {
			accountId,
			unit: "archive.partition.events",
			quantity: 1,
			source: "archive",
			idempotencyKey: randomUUID(),
		});
		expect(result.usdMicros).toBe(150_000n);
	});
});
