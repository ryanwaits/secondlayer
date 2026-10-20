import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { getDb } from "@secondlayer/shared/db";
import {
	type OwedRow,
	WAIVED_SOURCE,
	parseArgs,
	selectOwed,
	summarize,
	waiveOwed,
} from "./waive-sentinel-owed.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

function row(over: Partial<OwedRow> = {}): OwedRow {
	return {
		id: randomUUID(),
		account_id: "a1",
		unit: "sentinel.check_run",
		quantity: "1",
		usd_micros: "250000",
		source: "sentinel",
		idempotency_key: randomUUID(),
		occurred_at: new Date("2026-10-01T00:00:00Z"),
		...over,
	};
}

describe("parseArgs", () => {
	test("no args is a dry run", () => {
		expect(parseArgs([])).toEqual({
			apply: false,
			backup: null,
			account: null,
		});
	});

	test("--apply needs --backup, and --backup needs --apply", () => {
		expect(() => parseArgs(["--apply"])).toThrow("--backup");
		expect(() => parseArgs(["--backup", "x.json"])).toThrow("--apply");
		expect(parseArgs(["--apply", "--backup", "x.json"])).toMatchObject({
			apply: true,
			backup: "x.json",
		});
	});

	test("--account must be a uuid; unknown flags are refused", () => {
		expect(() => parseArgs(["--account", "nope"])).toThrow("uuid");
		expect(() => parseArgs(["--account"])).toThrow("needs a value");
		expect(() => parseArgs(["--force"])).toThrow("unknown");
		const id = randomUUID();
		expect(parseArgs(["--account", id]).account).toBe(id);
	});
});

describe("summarize", () => {
	test("counts rows, accounts and micros per unit", () => {
		const s = summarize([
			row({
				account_id: "a1",
				unit: "sentinel.check_run",
				usd_micros: "250000",
			}),
			row({
				account_id: "a1",
				unit: "sentinel.monitored_event",
				usd_micros: "15",
			}),
			row({
				account_id: "a2",
				unit: "sentinel.check_run",
				usd_micros: "750000",
			}),
		]);
		expect(s).toEqual({
			rows: 3,
			accounts: 2,
			usdMicros: 1_000_015n,
			byUnit: [
				{ unit: "sentinel.check_run", rows: 2, usdMicros: 1_000_000n },
				{ unit: "sentinel.monitored_event", rows: 1, usdMicros: 15n },
			],
		});
	});

	test("empty is all zeros", () => {
		expect(summarize([])).toEqual({
			rows: 0,
			accounts: 0,
			usdMicros: 0n,
			byUnit: [],
		});
	});
});

describe.skipIf(!HAS_DB)("waiveOwed", () => {
	const accountIds: string[] = [];

	async function makeAccount(): Promise<string> {
		const r = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountIds.push(r.id);
		return r.id;
	}

	async function seed(
		accountId: string,
		unit: string,
		usdMicros: number,
		debited: boolean,
	): Promise<string> {
		const key = randomUUID();
		await db
			.insertInto("usage_ledger")
			.values({
				account_id: accountId,
				unit,
				quantity: 1,
				usd_micros: String(usdMicros),
				debited,
				source: "sentinel",
				idempotency_key: key,
			})
			.execute();
		return key;
	}

	async function ledger(key: string) {
		return db
			.selectFrom("usage_ledger")
			.select(["usd_micros", "debited", "source", "quantity"])
			.where("idempotency_key", "=", key)
			.executeTakeFirstOrThrow();
	}

	afterAll(async () => {
		if (accountIds.length === 0) return;
		await db
			.deleteFrom("usage_ledger")
			.where("account_id", "in", accountIds)
			.execute();
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
	});

	test("waives only undebited sentinel.* rows of the account, once", async () => {
		const mine = await makeAccount();
		const other = await makeAccount();
		const owedA = await seed(mine, "sentinel.check_run", 250_000, false);
		const owedB = await seed(mine, "sentinel.monitored_event", 15, false);
		const paid = await seed(mine, "sentinel.check_run", 250_000, true);
		const notSentinel = await seed(mine, "rows.delivered", 777, false);
		const elsewhere = await seed(other, "sentinel.check_run", 250_000, false);

		// A dry-run select writes nothing.
		expect(summarize(await selectOwed(db, mine))).toMatchObject({
			rows: 2,
			usdMicros: 250_015n,
		});
		expect((await ledger(owedA)).usd_micros).toBe("250000");

		let backedUp: OwedRow[] = [];
		const s = await waiveOwed(db, {
			account: mine,
			onRows: (rows) => {
				backedUp = rows;
			},
		});
		expect(s).toMatchObject({ rows: 2, accounts: 1, usdMicros: 250_015n });
		expect(backedUp.map((r) => r.idempotency_key).sort()).toEqual(
			[owedA, owedB].sort(),
		);

		for (const key of [owedA, owedB]) {
			expect(await ledger(key)).toMatchObject({
				usd_micros: "0",
				debited: false,
				source: WAIVED_SOURCE,
			});
		}
		expect(await ledger(paid)).toMatchObject({
			usd_micros: "250000",
			debited: true,
			source: "sentinel",
		});
		expect(await ledger(notSentinel)).toMatchObject({
			usd_micros: "777",
			debited: false,
		});
		expect(await ledger(elsewhere)).toMatchObject({
			usd_micros: "250000",
			source: "sentinel",
		});

		// Second run finds nothing.
		expect((await waiveOwed(db, { account: mine })).rows).toBe(0);
	});

	test("a failing backup rolls the waiver back", async () => {
		const mine = await makeAccount();
		const key = await seed(mine, "sentinel.check_run", 250_000, false);
		await expect(
			waiveOwed(db, {
				account: mine,
				onRows: () => {
					throw new Error("disk full");
				},
			}),
		).rejects.toThrow("disk full");
		expect(await ledger(key)).toMatchObject({
			usd_micros: "250000",
			source: "sentinel",
		});
	});
});
