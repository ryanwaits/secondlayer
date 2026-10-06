import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { meter } from "@secondlayer/platform/billing/meter";
import {
	getBalanceAlerts,
	upsertBalanceAlerts,
} from "@secondlayer/platform/db/queries/account-balance-alerts";
import { creditCredits } from "@secondlayer/platform/db/queries/account-credits";
import { getDb } from "@secondlayer/shared/db";
import { checkAllBalances, checkOneBalance } from "./balance-alert.ts";

const db = getDb();
const ids: string[] = [];

async function makeAccount(email: string): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email, ghost: false })
		.returning("id")
		.executeTakeFirstOrThrow();
	ids.push(row.id);
	return row.id;
}

let prevResendKey: string | undefined;
beforeEach(() => {
	prevResendKey = process.env.RESEND_API_KEY;
	delete process.env.RESEND_API_KEY;
});
afterEach(() => {
	if (prevResendKey === undefined) delete process.env.RESEND_API_KEY;
	else process.env.RESEND_API_KEY = prevResendKey;
});

afterAll(async () => {
	if (ids.length > 0) {
		await db
			.deleteFrom("account_balance_alerts")
			.where("account_id", "in", ids)
			.execute();
		await db
			.deleteFrom("usage_ledger")
			.where("account_id", "in", ids)
			.execute();
		await db
			.deleteFrom("account_credits")
			.where("account_id", "in", ids)
			.execute();
		await db.deleteFrom("accounts").where("id", "in", ids).execute();
	}
});

const NOW = new Date("2026-09-28T12:00:00.000Z");

/** Seeds a trailing-24h burn rate of exactly 100,000µ$/day (10,000 webhook
 *  events x 10µ$), one hour before `at`. */
async function seedBurnRate(accountId: string, at: Date): Promise<void> {
	await meter(db, {
		accountId,
		unit: "webhook.event",
		quantity: 10_000,
		source: "test",
		idempotencyKey: `balance-alert-burn-${accountId}`,
		occurredAt: new Date(at.getTime() - 60 * 60 * 1000),
	});
}

describe("checkOneBalance", () => {
	test("low: runway between 2 and 7 days sends the 7d alert and debounces it", async () => {
		const id = await makeAccount(
			`balance-low-${crypto.randomUUID().slice(0, 8)}@test.invalid`,
		);
		await creditCredits(db, id, 500_000n); // $0.50 at $0.10/day = 5-day runway
		await seedBurnRate(id, NOW);

		await checkOneBalance({ id, email: `low-${id}@test.invalid` }, NOW);
		const after = await getBalanceAlerts(db, id);
		expect(after?.sent_7d_at).not.toBeNull();
		expect(after?.sent_2d_at).toBeNull();
		expect(after?.sent_stopped_at).toBeNull();

		// Debounce: a second check at the same instant must not re-fire (the
		// timestamp stays exactly what it was).
		const firstSentAt = after?.sent_7d_at?.getTime();
		await checkOneBalance({ id, email: `low-${id}@test.invalid` }, NOW);
		const again = await getBalanceAlerts(db, id);
		expect(again?.sent_7d_at?.getTime()).toBe(firstSentAt);
	});

	test("crit: runway at or under 2 days sends the 2d alert", async () => {
		const id = await makeAccount(
			`balance-crit-${crypto.randomUUID().slice(0, 8)}@test.invalid`,
		);
		await creditCredits(db, id, 150_000n); // $0.15 at $0.10/day = 1.5-day runway
		await seedBurnRate(id, NOW);

		await checkOneBalance({ id, email: `crit-${id}@test.invalid` }, NOW);
		const after = await getBalanceAlerts(db, id);
		expect(after?.sent_2d_at).not.toBeNull();
		expect(after?.sent_7d_at).toBeNull();
	});

	test("stopped: a stopped hosted stack at $0 balance sends the stopped alert", async () => {
		const id = await makeAccount(
			`balance-stopped-${crypto.randomUUID().slice(0, 8)}@test.invalid`,
		);
		// Hosted-stack state = stopped: a memory.gb_hour row within the
		// last 35 days but not the last 75 minutes.
		await meter(db, {
			accountId: id,
			unit: "memory.gb_hour",
			quantity: 0.5,
			source: "test",
			idempotencyKey: `balance-alert-svc-${id}`,
			occurredAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
		});
		// No creditCredits call: balance stays at $0.

		await checkOneBalance({ id, email: `stopped-${id}@test.invalid` }, NOW);
		const after = await getBalanceAlerts(db, id);
		expect(after?.sent_stopped_at).not.toBeNull();
	});

	test("notify7d off suppresses the low alert entirely", async () => {
		const id = await makeAccount(
			`balance-optout-${crypto.randomUUID().slice(0, 8)}@test.invalid`,
		);
		await upsertBalanceAlerts(db, id, { notify_7d: false });
		await creditCredits(db, id, 500_000n);
		await seedBurnRate(id, NOW);

		await checkOneBalance({ id, email: `optout-${id}@test.invalid` }, NOW);
		const after = await getBalanceAlerts(db, id);
		expect(after?.sent_7d_at).toBeNull();
	});

	test("re-arm: runway back over 7 days clears every debounce mark", async () => {
		const id = await makeAccount(
			`balance-rearm-${crypto.randomUUID().slice(0, 8)}@test.invalid`,
		);
		await creditCredits(db, id, 500_000n); // 5-day runway → low, sends + marks
		await seedBurnRate(id, NOW);
		await checkOneBalance({ id, email: `rearm-${id}@test.invalid` }, NOW);
		expect((await getBalanceAlerts(db, id))?.sent_7d_at).not.toBeNull();

		// Top up well past the 7-day-runway line at the same burn rate.
		await creditCredits(db, id, 10_000_000n);
		const later = new Date(NOW.getTime() + 60 * 60 * 1000);
		await checkOneBalance({ id, email: `rearm-${id}@test.invalid` }, later);

		const after = await getBalanceAlerts(db, id);
		expect(after?.sent_7d_at).toBeNull();
		expect(after?.sent_2d_at).toBeNull();
		expect(after?.sent_stopped_at).toBeNull();
	});

	test("no email address (ghost account) never throws, still debounces", async () => {
		const row = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();
		ids.push(row.id);
		await creditCredits(db, row.id, 500_000n);
		await seedBurnRate(row.id, NOW);

		await checkOneBalance({ id: row.id, email: null }, NOW);
		const after = await getBalanceAlerts(db, row.id);
		expect(after?.sent_7d_at).not.toBeNull();
	});
});

describe("checkAllBalances", () => {
	test("finds and alerts an account with recent spend, RESEND_API_KEY unset never throws", async () => {
		const id = await makeAccount(
			`balance-all-${crypto.randomUUID().slice(0, 8)}@test.invalid`,
		);
		await creditCredits(db, id, 500_000n);
		await seedBurnRate(id, NOW);

		await expect(checkAllBalances(NOW)).resolves.toBeUndefined();
		const after = await getBalanceAlerts(db, id);
		expect(after?.sent_7d_at).not.toBeNull();
	});
});
