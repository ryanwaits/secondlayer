import { afterAll, describe, expect, test } from "bun:test";
import { recordCreditsSpend } from "@secondlayer/platform/db/queries/account-credits";
import {
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
});
