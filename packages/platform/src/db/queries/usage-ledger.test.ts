import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { grantCredits, meter, recordTopup } from "../../billing/meter.ts";
import { ROWS_DELIVERED_MONTHLY_ALLOWANCE } from "../../billing/prices.ts";
import {
	creditsAdded,
	hostedStackSnapshot,
	rowsByKeyLast30d,
	rowsBySource,
	rowsDaily,
	rowsHourlyToday,
	rowsPerCallHistogram,
} from "./usage-ledger.ts";

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
});

afterAll(async () => {
	if (!HAS_DB) return;
	if (accountIds.length > 0) {
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	}
});

describe.skipIf(!HAS_DB)(
	"hostedStackSnapshot — memory24h hour bucketing",
	() => {
		test("two rows landing in the same hour (e.g. a retried flush re-dated at insert time) sum into one bucket, not two", async () => {
			const now = new Date("2026-09-28T12:00:00.000Z");
			// Both fall in the 10:00 UTC hour, minutes apart — the exact shape a
			// retry-dated-at-flush-time bug produces (several samples pinned to
			// one instant), which the aggregate must collapse to one point.
			await meter(db, {
				accountId,
				unit: "memory.gb_hour",
				quantity: 0.5,
				observedQuantity: 0.3,
				source: "test",
				idempotencyKey: `bucket-a-${accountId}`,
				occurredAt: new Date("2026-09-28T10:05:00.000Z"),
			});
			await meter(db, {
				accountId,
				unit: "memory.gb_hour",
				quantity: 0.5,
				observedQuantity: 0.35,
				source: "test",
				idempotencyKey: `bucket-b-${accountId}`,
				occurredAt: new Date("2026-09-28T10:40:00.000Z"),
			});

			const snapshot = await hostedStackSnapshot(db, accountId, now);
			expect(snapshot.memory24h).toHaveLength(1);
			expect(snapshot.memory24h[0]?.hour).toBe("2026-09-28T10:00:00.000Z");
			expect(snapshot.memory24h[0]?.billedGb).toBeCloseTo(1.0, 6);
			expect(snapshot.memory24h[0]?.observedGb).toBeCloseTo(0.65, 6);
		});

		test("many same-hour duplicates across the window still collapse to one bucket per distinct hour", async () => {
			const now = new Date("2026-09-28T12:00:00.000Z");
			// 3 rows each for 24 distinct hours (0..23h ago) — 72 rows total, all
			// within the 24h window, clustered so several land in the same UTC
			// hour together. Bucketing must report exactly 24 points, never 72.
			let i = 0;
			for (let h = 0; h < 24; h++) {
				for (let s = 0; s < 3; s++) {
					i++;
					// Offset by seconds, never minutes — stays inside hour `h`'s own
					// bucket instead of spilling into the adjacent one.
					await meter(db, {
						accountId,
						unit: "memory.gb_hour",
						quantity: 0.5,
						observedQuantity: 0.4,
						source: "test",
						idempotencyKey: `bucket-many-${accountId}-${i}`,
						occurredAt: new Date(now.getTime() - h * 60 * 60 * 1000 + s * 1000),
					});
				}
			}

			const snapshot = await hostedStackSnapshot(db, accountId, now);
			expect(snapshot.memory24h).toHaveLength(24);
		});

		test("ordinary one-row-per-hour data still reports one point per hour, oldest first", async () => {
			const now = new Date("2026-09-28T12:00:00.000Z");
			await meter(db, {
				accountId,
				unit: "memory.gb_hour",
				quantity: 0.5,
				observedQuantity: 0.3,
				source: "test",
				idempotencyKey: `bucket-hour1-${accountId}`,
				occurredAt: new Date("2026-09-28T10:00:00.000Z"),
			});
			await meter(db, {
				accountId,
				unit: "memory.gb_hour",
				quantity: 0.5,
				observedQuantity: 0.32,
				source: "test",
				idempotencyKey: `bucket-hour2-${accountId}`,
				occurredAt: new Date("2026-09-28T11:00:00.000Z"),
			});

			const snapshot = await hostedStackSnapshot(db, accountId, now);
			expect(snapshot.memory24h).toHaveLength(2);
			expect(snapshot.memory24h[0]?.hour).toBe("2026-09-28T10:00:00.000Z");
			expect(snapshot.memory24h[1]?.hour).toBe("2026-09-28T11:00:00.000Z");
		});
	},
);

describe.skipIf(!HAS_DB)("rowsByKeyLast30d", () => {
	test("sums recent attributed reads per key, ignoring old and unattributed rows", async () => {
		const now = new Date("2026-10-15T12:00:00.000Z");
		const keyA = crypto.randomUUID();
		const keyB = crypto.randomUUID();
		const read = (
			suffix: string,
			quantity: number,
			occurredAt: Date,
			apiKeyId: string | null,
		) =>
			meter(db, {
				accountId,
				unit: "rows.delivered",
				quantity,
				source: "test",
				idempotencyKey: `by-key-${suffix}-${accountId}`,
				occurredAt,
				apiKeyId,
			});
		await read("a1", 10, new Date("2026-10-10T00:00:00.000Z"), keyA);
		await read("a2", 5, new Date("2026-10-14T00:00:00.000Z"), keyA);
		// Outside the 30-day window.
		await read("a-old", 100, new Date("2026-09-01T00:00:00.000Z"), keyA);
		// Unattributed: counted for no key.
		await read("none", 7, new Date("2026-10-12T00:00:00.000Z"), null);

		const totals = await rowsByKeyLast30d(db, accountId, now);
		expect(totals.get(keyA)).toBe(15);
		expect(totals.has(keyB)).toBe(false);
		expect(totals.size).toBe(1);
	});
});

describe.skipIf(!HAS_DB)("creditsAdded", () => {
	test("returns top-ups and grants newest first with positive amounts", async () => {
		await recordTopup(db, {
			accountId,
			usdMicros: 25_000_000n,
			source: "stripe",
			idempotencyKey: `credits-topup-${accountId}`,
			occurredAt: new Date("2026-10-02T10:00:00.000Z"),
		});
		await grantCredits(db, {
			accountId,
			usdMicros: 5_000_000n,
			source: "sentinel:starter",
			idempotencyKey: `credits-grant-${accountId}`,
			occurredAt: new Date("2026-10-09T10:00:00.000Z"),
		});

		const credits = await creditsAdded(db, accountId);
		expect(credits).toEqual([
			{
				occurredAt: "2026-10-09T10:00:00.000Z",
				kind: "grant",
				source: "sentinel:starter",
				usdMicros: "5000000",
			},
			{
				occurredAt: "2026-10-02T10:00:00.000Z",
				kind: "topup",
				source: "stripe",
				usdMicros: "25000000",
			},
		]);
	});

	test("never returns a regular charge", async () => {
		await meter(db, {
			accountId,
			unit: "rows.delivered",
			quantity: 10,
			source: "test",
			idempotencyKey: `credits-charge-${accountId}`,
			occurredAt: new Date("2026-10-03T10:00:00.000Z"),
		});
		expect(await creditsAdded(db, accountId)).toEqual([]);
	});

	test("honors the limit", async () => {
		for (let i = 0; i < 3; i++) {
			await grantCredits(db, {
				accountId,
				usdMicros: 1_000_000n,
				source: "test",
				idempotencyKey: `credits-limit-${i}-${accountId}`,
				occurredAt: new Date(`2026-10-0${i + 1}T10:00:00.000Z`),
			});
		}
		const credits = await creditsAdded(db, accountId, 2);
		expect(credits).toHaveLength(2);
		expect(credits[0]?.occurredAt).toBe("2026-10-03T10:00:00.000Z");
	});
});

describe.skipIf(!HAS_DB)("rows screen queries", () => {
	const now = new Date("2026-10-15T12:00:00.000Z");

	async function page(
		suffix: string,
		quantity: number,
		occurredAt: Date,
		source = "index",
		forAccount?: string,
	) {
		const id = forAccount ?? accountId;
		await meter(db, {
			accountId: id,
			unit: "rows.delivered",
			quantity,
			source,
			idempotencyKey: `rows-q-${suffix}-${id}`,
			occurredAt,
		});
	}

	test("rowsDaily groups by UTC day and source and splits free from paid per page", async () => {
		// Exhaust the allowance with one page, then read two more.
		await page(
			"exhaust",
			ROWS_DELIVERED_MONTHLY_ALLOWANCE,
			new Date("2026-10-06T08:00:00.000Z"),
		);
		await page("paid-a", 40, new Date("2026-10-06T23:59:00.000Z"));
		await page("paid-b", 60, new Date("2026-10-07T00:01:00.000Z"), "streams");

		const days = await rowsDaily(db, accountId, 30, now);
		expect(days.map((d) => [d.date, d.source])).toEqual([
			["2026-10-06", "index"],
			["2026-10-07", "streams"],
		]);
		const first = days[0];
		expect(first?.rows).toBe(ROWS_DELIVERED_MONTHLY_ALLOWANCE + 40);
		expect(first?.freeRows).toBe(ROWS_DELIVERED_MONTHLY_ALLOWANCE);
		expect(first?.paidRows).toBe(40);
		expect(first?.calls).toBe(2);
		expect(Number(first?.paidUsdMicros)).toBeGreaterThan(0);
		expect(days[1]?.paidRows).toBe(60);
		expect(days[1]?.freeRows).toBe(0);
	});

	test("rowsDaily excludes rows older than the window and other accounts", async () => {
		const other = await makeAccount();
		await page("in", 5, new Date("2026-10-14T10:00:00.000Z"));
		// The 30-day window opens 2026-09-16 00:00 UTC.
		await page("old", 9, new Date("2026-09-15T23:59:00.000Z"));
		await page(
			"other",
			99,
			new Date("2026-10-14T10:00:00.000Z"),
			"index",
			other,
		);
		const days = await rowsDaily(db, accountId, 30, now);
		expect(days.map((d) => d.rows)).toEqual([5]);
		await db
			.deleteFrom("usage_ledger")
			.where("account_id", "=", other)
			.execute();
	});

	test("rowsHourlyToday buckets by UTC hour since midnight only", async () => {
		await page("h1", 3, new Date("2026-10-15T01:10:00.000Z"));
		await page("h2", 4, new Date("2026-10-15T01:50:00.000Z"));
		await page("yesterday", 8, new Date("2026-10-14T23:50:00.000Z"));
		const hours = await rowsHourlyToday(db, accountId, now);
		expect(hours).toEqual([
			{ hour: "2026-10-15T01:00:00.000Z", source: "index", rows: 7, calls: 2 },
		]);
	});

	test("rowsPerCallHistogram returns all five buckets, zero-filled", async () => {
		await page("b1", 1, new Date("2026-10-10T00:00:00.000Z"));
		await page("b2", 9, new Date("2026-10-10T00:01:00.000Z"));
		await page("b3", 10, new Date("2026-10-10T00:02:00.000Z"));
		await page("b4", 499, new Date("2026-10-10T00:03:00.000Z"));
		await page("b5", 1000, new Date("2026-10-10T00:04:00.000Z"));
		const bins = await rowsPerCallHistogram(db, accountId, 30, now);
		expect(bins.map((b) => [b.bucket, b.calls])).toEqual([
			["1-9", 2],
			["10-99", 1],
			["100-499", 1],
			["500-999", 0],
			["1000+", 1],
		]);
		expect(bins[0]?.rows).toBe(10);
	});

	test("rowsPerCallHistogram is all zeros for an account with no reads", async () => {
		const bins = await rowsPerCallHistogram(db, accountId, 30, now);
		expect(bins).toHaveLength(5);
		expect(bins.every((b) => b.calls === 0 && b.rows === 0)).toBe(true);
	});

	test("rowsBySource totals rows and calls per source", async () => {
		await page("s1", 10, new Date("2026-10-10T00:00:00.000Z"));
		await page("s2", 20, new Date("2026-10-11T00:00:00.000Z"));
		await page("s3", 5, new Date("2026-10-11T00:00:00.000Z"), "streams");
		expect(await rowsBySource(db, accountId, 30, now)).toEqual([
			{ source: "index", rows: 30, calls: 2 },
			{ source: "streams", rows: 5, calls: 1 },
		]);
	});
});
