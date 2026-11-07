import { afterAll, describe, expect, test } from "bun:test";
import { recordCreditsSpend } from "@secondlayer/platform/db/queries/account-credits";
import {
	claimCapMark,
	getCaps,
	upsertCaps,
} from "@secondlayer/platform/db/queries/account-spend-caps";
import { getDb } from "@secondlayer/shared/db";
import { checkAllCaps } from "./spend-cap-alert.ts";

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

afterAll(async () => {
	if (ids.length > 0) {
		await db
			.deleteFrom("account_spend_caps")
			.where("account_id", "in", ids)
			.execute();
		await db
			.deleteFrom("account_credits")
			.where("account_id", "in", ids)
			.execute();
		await db.deleteFrom("accounts").where("id", "in", ids).execute();
	}
});

describe("checkAllCaps", () => {
	test("under threshold → no alert, no freeze", async () => {
		const id = await makeAccount(
			`cap-under-${crypto.randomUUID().slice(0, 8)}@example.com`,
		);
		// cap=10_000¢, threshold=80% → 8000¢; seed 5000¢ spend
		await upsertCaps(db, id, {
			monthly_cap_cents: 10_000,
			alert_threshold_pct: 80,
		});
		await recordCreditsSpend(db, id, 5_000n * 10_000n);

		await checkAllCaps();

		const caps = await getCaps(db, id);
		expect(caps).not.toBeNull();
		expect(caps?.frozen_at).toBeNull();
		expect(caps?.alert_sent_at).toBeNull();
	});

	test("at/over cap → frozen_at set", async () => {
		const id = await makeAccount(
			`cap-frozen-${crypto.randomUUID().slice(0, 8)}@example.com`,
		);
		// seed 10_000¢ spend = exactly at cap
		await upsertCaps(db, id, { monthly_cap_cents: 10_000 });
		await recordCreditsSpend(db, id, 10_000n * 10_000n);

		const before = await getCaps(db, id);
		expect(before?.frozen_at).toBeNull();

		await checkAllCaps();

		const caps = await getCaps(db, id);
		expect(caps).not.toBeNull();
		expect(caps?.frozen_at).not.toBeNull();
	});

	test("stale freeze cleared on rollover (projected=0 < cap)", async () => {
		const id = await makeAccount(
			`cap-unfreeze-${crypto.randomUUID().slice(0, 8)}@example.com`,
		);
		// seed frozen_at to a past date; no current-month spend → projected=0
		const pastDate = new Date("2026-01-01T00:00:00Z");
		await upsertCaps(db, id, {
			monthly_cap_cents: 10_000,
			frozen_at: pastDate,
		});

		// No recordCreditsSpend → getMonthlyCreditsSpend returns 0n

		await checkAllCaps();

		const caps = await getCaps(db, id);
		expect(caps).not.toBeNull();
		expect(caps?.frozen_at).toBeNull();
	});

	test("a failed cap-reached send hands the mark back and the next tick sends it", async () => {
		const id = await makeAccount(
			`cap-retry-${crypto.randomUUID().slice(0, 8)}@example.com`,
		);
		await upsertCaps(db, id, { monthly_cap_cents: 10_000 });
		await recordCreditsSpend(db, id, 10_000n * 10_000n);
		const failing = {
			sendEmail: async () => {
				throw new Error("smtp down");
			},
		};

		// checkAllCaps isolates per-account failures, so the throw is logged.
		await checkAllCaps(failing);
		expect((await getCaps(db, id))?.frozen_at).toBeNull();

		const sent: { to: string }[] = [];
		await checkAllCaps({
			sendEmail: async (m) => {
				if (m.to.startsWith("cap-retry-")) {
					sent.push({ to: m.to });
				}
				return { id: "x" } as never;
			},
		});
		expect(sent).toHaveLength(1);
		expect((await getCaps(db, id))?.frozen_at).not.toBeNull();
	});

	test("a threshold alert that fails to send is retried, not recorded as sent", async () => {
		const id = await makeAccount(
			`cap-threshold-retry-${crypto.randomUUID().slice(0, 8)}@example.com`,
		);
		// cap 10_000c, threshold 80% = 8_000c; spend 8_500c
		await upsertCaps(db, id, {
			monthly_cap_cents: 10_000,
			alert_threshold_pct: 80,
		});
		await recordCreditsSpend(db, id, 8_500n * 10_000n);
		await checkAllCaps({
			sendEmail: async () => {
				throw new Error("smtp down");
			},
		});
		expect((await getCaps(db, id))?.alert_sent_at).toBeNull();
		await checkAllCaps({ sendEmail: async () => ({ id: "x" }) as never });
		expect((await getCaps(db, id))?.alert_sent_at).not.toBeNull();
	});

	test("a cap raised after spend was measured is not marked by the stale run", async () => {
		const id = await makeAccount(
			`cap-stale-${crypto.randomUUID().slice(0, 8)}@example.com`,
		);
		await upsertCaps(db, id, { monthly_cap_cents: 10_000 });
		// The cron measured spend against a 10_000c cap; the owner then raised it.
		await upsertCaps(db, id, { monthly_cap_cents: 50_000 });
		const claimed = await claimCapMark(db, id, "frozen_at", {
			cap: 10_000,
			now: new Date(),
		});
		expect(claimed).toBe(false);
		expect((await getCaps(db, id))?.frozen_at).toBeNull();
	});

	test("two runners at the cap send the cap-reached email once", async () => {
		const id = await makeAccount(
			`cap-race-${crypto.randomUUID().slice(0, 8)}@example.com`,
		);
		await upsertCaps(db, id, { monthly_cap_cents: 10_000 });
		await recordCreditsSpend(db, id, 10_000n * 10_000n);
		let sends = 0;
		const deps = {
			sendEmail: async (m: { to: string }) => {
				if (m.to.startsWith("cap-race-")) sends += 1;
				return { id: "x" } as never;
			},
		};
		await Promise.all([checkAllCaps(deps), checkAllCaps(deps)]);
		expect(sends).toBe(1);
	});
});
