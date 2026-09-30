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
import { owedSentinelUsdMicros } from "../db/queries/usage-ledger.ts";
import { grantCredits, meter, settleOwedSentinel } from "./meter.ts";
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

	test("allowance boundary: row 1,000,000 free, 1,000,001st charged", async () => {
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

describe.skipIf(!HAS_DB)("meter — fractional hosted-stack units", () => {
	test("memory.gb_hour prices a fractional GB-hour and stores the exact quantity", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const idempotencyKey = randomUUID();
		const result = await meter(db, {
			accountId,
			unit: "memory.gb_hour",
			quantity: 0.375,
			source: "internal:provisioner",
			idempotencyKey,
		});
		expect(result.usdMicros).toBe(10_500n);
		expect(result.debited).toBe(true);
		const row = await db
			.selectFrom("usage_ledger")
			.select("quantity")
			.where("idempotency_key", "=", idempotencyKey)
			.executeTakeFirstOrThrow();
		expect(Number(row.quantity)).toBe(0.375);
	});

	test("storage.gb_day rounds a sub-µ$ charge to the nearest µ$", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const result = await meter(db, {
			accountId,
			unit: "storage.gb_day",
			quantity: 0.0001,
			source: "internal:provisioner",
			idempotencyKey: randomUUID(),
		});
		expect(result.usdMicros).toBe(1n);
	});

	test("memory.gb_hour stores observedQuantity alongside the floored quantity, priced off quantity only", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const idempotencyKey = randomUUID();
		const result = await meter(db, {
			accountId,
			unit: "memory.gb_hour",
			quantity: 0.5,
			observedQuantity: 0.098,
			source: "internal:provisioner",
			idempotencyKey,
		});
		// Priced off the floored quantity (0.5 GB-h), never the raw sample.
		expect(result.usdMicros).toBe(14_000n);
		const row = await db
			.selectFrom("usage_ledger")
			.select(["quantity", "observed_quantity"])
			.where("idempotency_key", "=", idempotencyKey)
			.executeTakeFirstOrThrow();
		expect(Number(row.quantity)).toBe(0.5);
		expect(Number(row.observed_quantity)).toBeCloseTo(0.098, 6);
	});

	test("a unit with no observedQuantity stores NULL", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		const idempotencyKey = randomUUID();
		await meter(db, {
			accountId,
			unit: "storage.gb_day",
			quantity: 1,
			source: "internal:provisioner",
			idempotencyKey,
		});
		const row = await db
			.selectFrom("usage_ledger")
			.select("observed_quantity")
			.where("idempotency_key", "=", idempotencyKey)
			.executeTakeFirstOrThrow();
		expect(row.observed_quantity).toBeNull();
	});
});

describe.skipIf(!HAS_DB)("meter — sentinel units and grants", () => {
	test("sentinel.run prices flat at $1.50, sentinel.monitored_event at 15µ$ each", async () => {
		await creditCredits(db, accountId, 10_000_000n);
		const run = await meter(db, {
			accountId,
			unit: "sentinel.run",
			quantity: 1,
			source: "test",
			idempotencyKey: randomUUID(),
		});
		expect(run.usdMicros).toBe(1_500_000n);
		const events = await meter(db, {
			accountId,
			unit: "sentinel.monitored_event",
			quantity: 1000,
			source: "test",
			idempotencyKey: randomUUID(),
		});
		expect(events.usdMicros).toBe(15_000n);
		expect(await getCredits(db, accountId)).toBe(10_000_000n - 1_515_000n);
	});

	test("grantCredits credits once; the same key never credits twice", async () => {
		const key = `sentinel:starter:${accountId}`;
		const first = await grantCredits(db, {
			accountId,
			usdMicros: 5_000_000n,
			source: "sentinel:starter",
			idempotencyKey: key,
		});
		expect(first).toEqual({ granted: true, balance: 5_000_000n });

		const second = await grantCredits(db, {
			accountId,
			usdMicros: 5_000_000n,
			source: "sentinel:starter",
			idempotencyKey: key,
		});
		expect(second).toEqual({ granted: false, balance: 5_000_000n });
		expect(await getCredits(db, accountId)).toBe(5_000_000n);

		const rows = await db
			.selectFrom("usage_ledger")
			.select(["unit", "usd_micros", "source"])
			.where("idempotency_key", "=", key)
			.execute();
		expect(rows).toEqual([
			{ unit: "grant", usd_micros: "-5000000", source: "sentinel:starter" },
		]);
		// A grant is money in, not spend.
		expect(await getMonthlyCreditsSpend(db, accountId)).toBe(0n);
	});

	async function owe(unit: string, usdMicros: bigint, at: string, key: string) {
		await db
			.insertInto("usage_ledger")
			.values({
				account_id: accountId,
				unit,
				quantity: 1,
				usd_micros: usdMicros.toString(),
				debited: false,
				source: "test",
				idempotency_key: key,
				occurred_at: new Date(at),
			})
			.execute();
	}

	test("owed sums only debited=false sentinel.* rows", async () => {
		const k = randomUUID();
		await owe("sentinel.run", 1_500_000n, "2026-09-01T00:00:00Z", `${k}:a`);
		await owe(
			"sentinel.monitored_event",
			15n,
			"2026-09-02T00:00:00Z",
			`${k}:b`,
		);
		await owe("webhook.event", 999n, "2026-09-02T00:00:00Z", `${k}:c`);
		await owe("rows.delivered", 777n, "2026-09-02T00:00:00Z", `${k}:d`);
		expect(await owedSentinelUsdMicros(db, accountId)).toBe(1_500_015n);
	});

	test("settle pays oldest first while the balance covers each, never touches other units", async () => {
		const k = randomUUID();
		await owe(
			"sentinel.deep_audit",
			3_000_000n,
			"2026-09-01T00:00:00Z",
			`${k}:a`,
		);
		await owe("sentinel.run", 1_500_000n, "2026-09-02T00:00:00Z", `${k}:b`);
		await owe("rows.delivered", 500_000n, "2026-09-01T00:00:00Z", `${k}:c`);
		await creditCredits(db, accountId, 4_000_000n);

		const r1 = await settleOwedSentinel(db, accountId);
		// oldest ($3) paid; next ($1.50) not covered by the remaining $1 -> stays owed
		expect(r1).toEqual({
			settledUsdMicros: 3_000_000n,
			owedUsdMicros: 1_500_000n,
			balanceUsdMicros: 1_000_000n,
		});
		expect(await getMonthlyCreditsSpend(db, accountId)).toBe(3_000_000n);

		await creditCredits(db, accountId, 1_000_000n);
		const r2 = await settleOwedSentinel(db, accountId);
		expect(r2).toEqual({
			settledUsdMicros: 1_500_000n,
			owedUsdMicros: 0n,
			balanceUsdMicros: 500_000n,
		});

		// Replay settles nothing.
		const r3 = await settleOwedSentinel(db, accountId);
		expect(r3.settledUsdMicros).toBe(0n);
		expect(r3.balanceUsdMicros).toBe(500_000n);

		const other = await db
			.selectFrom("usage_ledger")
			.select("debited")
			.where("idempotency_key", "=", `${k}:c`)
			.executeTakeFirstOrThrow();
		expect(other.debited).toBe(false);
	});

	test("concurrent settles debit each owed row exactly once", async () => {
		const k = randomUUID();
		await owe("sentinel.run", 1_500_000n, "2026-09-01T00:00:00Z", `${k}:a`);
		await owe("sentinel.run", 1_500_000n, "2026-09-02T00:00:00Z", `${k}:b`);
		await creditCredits(db, accountId, 10_000_000n);
		const results = await Promise.all([
			settleOwedSentinel(db, accountId),
			settleOwedSentinel(db, accountId),
			settleOwedSentinel(db, accountId),
		]);
		const total = results.reduce((n, r) => n + r.settledUsdMicros, 0n);
		expect(total).toBe(3_000_000n);
		expect(await getCredits(db, accountId)).toBe(7_000_000n);
		expect(await owedSentinelUsdMicros(db, accountId)).toBe(0n);
	});

	test("settle with no balance changes nothing", async () => {
		await owe("sentinel.run", 1_500_000n, "2026-09-01T00:00:00Z", randomUUID());
		const r = await settleOwedSentinel(db, accountId);
		expect(r).toEqual({
			settledUsdMicros: 0n,
			owedUsdMicros: 1_500_000n,
			balanceUsdMicros: 0n,
		});
	});
});
