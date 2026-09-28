import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { meter } from "../../billing/meter.ts";
import { deliveryServiceSnapshot } from "./usage-ledger.ts";

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
	"deliveryServiceSnapshot — memory24h hour bucketing",
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

			const snapshot = await deliveryServiceSnapshot(db, accountId, now);
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

			const snapshot = await deliveryServiceSnapshot(db, accountId, now);
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

			const snapshot = await deliveryServiceSnapshot(db, accountId, now);
			expect(snapshot.memory24h).toHaveLength(2);
			expect(snapshot.memory24h[0]?.hour).toBe("2026-09-28T10:00:00.000Z");
			expect(snapshot.memory24h[1]?.hour).toBe("2026-09-28T11:00:00.000Z");
		});
	},
);
