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
	allowancePartitionsUsedThisMonth,
	recentChargedPaths,
	recordFetch,
} from "./archive-fetches.ts";

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
			.deleteFrom("archive_fetches")
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

describe.skipIf(!HAS_DB)("recentChargedPaths", () => {
	test("returns only paths charged within the last 24h", async () => {
		const now = new Date("2026-08-16T12:00:00Z");
		const recent = new Date("2026-08-16T00:00:00Z"); // 12h ago
		const stale = new Date("2026-08-14T00:00:00Z"); // >24h ago

		await recordFetch(
			db,
			{
				accountId,
				path: "blocks/0-50000-a.parquet",
				dataset: "blocks",
				usdMicros: 50_000n,
				viaAllowance: false,
			},
			recent,
		);
		await recordFetch(
			db,
			{
				accountId,
				path: "blocks/50000-100000-b.parquet",
				dataset: "blocks",
				usdMicros: 50_000n,
				viaAllowance: false,
			},
			stale,
		);

		const charged = await recentChargedPaths(
			db,
			accountId,
			[
				"blocks/0-50000-a.parquet",
				"blocks/50000-100000-b.parquet",
				"blocks/100000-150000-c.parquet",
			],
			now,
		);
		expect(charged.has("blocks/0-50000-a.parquet")).toBe(true);
		expect(charged.has("blocks/50000-100000-b.parquet")).toBe(false);
		expect(charged.has("blocks/100000-150000-c.parquet")).toBe(false);
	});

	test("empty paths returns empty set without querying", async () => {
		const charged = await recentChargedPaths(db, accountId, []);
		expect(charged.size).toBe(0);
	});

	test("scoped per account", async () => {
		const otherAccountId = await makeAccount();
		const now = new Date("2026-08-16T12:00:00Z");
		await recordFetch(
			db,
			{
				accountId: otherAccountId,
				path: "blocks/0-50000-a.parquet",
				dataset: "blocks",
				usdMicros: 50_000n,
				viaAllowance: false,
			},
			now,
		);
		const charged = await recentChargedPaths(
			db,
			accountId,
			["blocks/0-50000-a.parquet"],
			now,
		);
		expect(charged.has("blocks/0-50000-a.parquet")).toBe(false);
		await db
			.deleteFrom("archive_fetches")
			.where("account_id", "=", otherAccountId)
			.execute();
	});
});

describe.skipIf(!HAS_DB)("allowancePartitionsUsedThisMonth", () => {
	test("counts only via_allowance rows in the given month", async () => {
		const inMonth = new Date("2026-08-05T00:00:00Z");
		const alsoInMonth = new Date("2026-08-20T00:00:00Z");
		const otherMonth = new Date("2026-07-31T23:59:59Z");
		const now = new Date("2026-08-16T00:00:00Z");

		await recordFetch(
			db,
			{
				accountId,
				path: "events/0-50000-a.parquet",
				dataset: "events",
				usdMicros: 0n,
				viaAllowance: true,
			},
			inMonth,
		);
		await recordFetch(
			db,
			{
				accountId,
				path: "events/50000-100000-b.parquet",
				dataset: "events",
				usdMicros: 0n,
				viaAllowance: true,
			},
			alsoInMonth,
		);
		// Charged (not allowance) — must not count.
		await recordFetch(
			db,
			{
				accountId,
				path: "events/100000-150000-c.parquet",
				dataset: "events",
				usdMicros: 150_000n,
				viaAllowance: false,
			},
			inMonth,
		);
		// Allowance, but a different month — must not count.
		await recordFetch(
			db,
			{
				accountId,
				path: "events/150000-200000-d.parquet",
				dataset: "events",
				usdMicros: 0n,
				viaAllowance: true,
			},
			otherMonth,
		);

		const used = await allowancePartitionsUsedThisMonth(db, accountId, now);
		expect(used).toBe(2);
	});

	test("zero when nothing recorded", async () => {
		const used = await allowancePartitionsUsedThisMonth(db, accountId);
		expect(used).toBe(0);
	});
});
