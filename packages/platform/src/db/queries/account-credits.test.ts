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
	accountSpendState,
	claimRefill,
	creditCredits,
	debitCredits,
	getCreditRefill,
	getCredits,
	getCreditsStatus,
	getMonthlyCreditsSpend,
	recordCreditsSpend,
	setCreditRefill,
} from "./account-credits.ts";
import { upsertCaps } from "./account-spend-caps.ts";

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

describe.skipIf(!HAS_DB)("getCreditsStatus", () => {
	test("an empty balance stops a normal account", async () => {
		expect(await getCreditsStatus(db, accountId)).toEqual({
			ok: false,
			reason: "credits",
		});
	});

	test("an internal account may always run, with no balance", async () => {
		await db
			.updateTable("accounts")
			.set({ internal: true })
			.where("id", "=", accountId)
			.execute();
		expect(await getCreditsStatus(db, accountId)).toEqual({
			ok: true,
			reason: null,
		});
	});
});

describe.skipIf(!HAS_DB)("accountSpendState", () => {
	test("a balance of exactly one page (5,000 micros) may read and run", async () => {
		await creditCredits(db, accountId, 5_000n);
		const state = await accountSpendState(db, accountId);
		expect(state.balance).toBe(5_000n);
		expect(state.canRead).toBe(true);
		expect(state.canRunStack).toBe(true);
		expect(state.readBlock).toBeNull();
		expect(state.stackBlock).toBeNull();
	});

	test("one micro under a page refuses reads but the stack still runs", async () => {
		await creditCredits(db, accountId, 4_999n);
		const state = await accountSpendState(db, accountId);
		expect(state.canRead).toBe(false);
		expect(state.readBlock).toBe("credits");
		expect(state.canRunStack).toBe(true);
	});

	test("a zero balance stops both, naming credits", async () => {
		const state = await accountSpendState(db, accountId);
		expect(state.canRead).toBe(false);
		expect(state.canRunStack).toBe(false);
		expect(state.readBlock).toBe("credits");
		expect(state.stackBlock).toBe("credits");
	});

	test("spend at the cap (1 cent = 10,000 micros) stops both and names the cap, even with balance", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		await upsertCaps(db, accountId, { monthly_cap_cents: 1 });
		await recordCreditsSpend(db, accountId, 9_999n);
		expect((await accountSpendState(db, accountId)).overCap).toBe(false);
		await recordCreditsSpend(db, accountId, 1n);
		const state = await accountSpendState(db, accountId);
		expect(state.overCap).toBe(true);
		expect(state.canRead).toBe(false);
		expect(state.canRunStack).toBe(false);
		expect(state.readBlock).toBe("cap");
		expect(state.stackBlock).toBe("cap");
	});

	test("with no balance and over the cap, a read names the cap and the stack names credits", async () => {
		await upsertCaps(db, accountId, { monthly_cap_cents: 0 });
		const state = await accountSpendState(db, accountId);
		expect(state.readBlock).toBe("cap");
		expect(state.stackBlock).toBe("credits");
	});

	test("a cleared cap lets a funded account spend again", async () => {
		await creditCredits(db, accountId, 1_000_000n);
		await upsertCaps(db, accountId, { monthly_cap_cents: 0 });
		expect((await accountSpendState(db, accountId)).canRunStack).toBe(false);
		await upsertCaps(db, accountId, { monthly_cap_cents: null });
		expect((await accountSpendState(db, accountId)).canRunStack).toBe(true);
	});

	test("an internal account may always read and run, with no balance and a tripped cap", async () => {
		await db
			.updateTable("accounts")
			.set({ internal: true })
			.where("id", "=", accountId)
			.execute();
		await upsertCaps(db, accountId, { monthly_cap_cents: 0 });
		const state = await accountSpendState(db, accountId);
		expect(state.canRead).toBe(true);
		expect(state.canRunStack).toBe(true);
		expect(state.overCap).toBe(false);
	});
});

describe.skipIf(!HAS_DB)("claimRefill", () => {
	async function armRefill(balance: bigint, below: bigint) {
		await creditCredits(db, accountId, balance);
		await setCreditRefill(db, accountId, {
			belowUsdMicros: below,
			packUsd: 25,
		});
	}

	test("the first claim returns the stored timestamp and a second claim inside the cooldown gets null", async () => {
		await armRefill(1_000_000n, 5_000_000n);
		const now = new Date("2026-11-07T12:00:00.000Z");
		const first = await claimRefill(db, accountId, now);
		expect(first?.toISOString()).toBe(now.toISOString());
		expect((await getCreditRefill(db, accountId)).lastAt?.toISOString()).toBe(
			now.toISOString(),
		);
		expect(
			await claimRefill(db, accountId, new Date(now.getTime() + 59 * 60_000)),
		).toBeNull();
	});

	test("a claim after the one-hour cooldown wins again", async () => {
		await armRefill(1_000_000n, 5_000_000n);
		const now = new Date("2026-11-07T12:00:00.000Z");
		await claimRefill(db, accountId, now);
		const later = new Date(now.getTime() + 61 * 60_000);
		expect((await claimRefill(db, accountId, later))?.toISOString()).toBe(
			later.toISOString(),
		);
	});

	test("concurrent claims: exactly one wins", async () => {
		await armRefill(1_000_000n, 5_000_000n);
		const now = new Date();
		const results = await Promise.all(
			Array.from({ length: 5 }, () => claimRefill(db, accountId, now)),
		);
		expect(results.filter((r) => r !== null)).toHaveLength(1);
	});

	test("a balance at the threshold (not below it) is not claimable", async () => {
		await armRefill(5_000_000n, 5_000_000n);
		expect(await claimRefill(db, accountId)).toBeNull();
	});

	test("a turned-off refill is not claimable", async () => {
		await armRefill(1_000_000n, 5_000_000n);
		await setCreditRefill(db, accountId, {
			belowUsdMicros: null,
			packUsd: null,
		});
		expect(await claimRefill(db, accountId)).toBeNull();
	});
});
