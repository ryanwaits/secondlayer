import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	markEmailed,
	purgeResolved,
	syncIncidents,
} from "./webhook-incident-alerts.ts";

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

afterAll(async () => {
	if (!HAS_DB || accountIds.length === 0) return;
	// ON DELETE CASCADE clears the incident rows.
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

const since = new Date("2026-10-15T10:00:00Z");
const now = new Date("2026-10-15T10:20:00Z");
const item = (id: string) => ({ id, name: `hook ${id}`, failingSince: since });

describe.skipIf(!HAS_DB)("webhook incident alerts", () => {
	test("opens once per incident, closes on recovery, re-opens on a new outage", async () => {
		const acct = await makeAccount();
		const both = { webhookIds: ["a", "b", "c"], down: [item("a"), item("b")] };

		const first = await syncIncidents(db, acct, both, now);
		expect(first.opened.map((r) => r.webhook_id).sort()).toEqual(["a", "b"]);

		const again = await syncIncidents(db, acct, both, now);
		expect(again.opened).toHaveLength(0);
		expect(again.resolved).toBe(0);

		const recovered = await syncIncidents(
			db,
			acct,
			{ webhookIds: ["a", "b", "c"], down: [item("a")] },
			now,
		);
		expect(recovered.opened).toHaveLength(0);
		expect(recovered.resolved).toBe(1);

		const reopened = await syncIncidents(db, acct, both, now);
		expect(reopened.opened.map((r) => r.webhook_id)).toEqual(["b"]);
	});

	test("an empty down list resolves every open incident", async () => {
		const acct = await makeAccount();
		await syncIncidents(
			db,
			acct,
			{ webhookIds: ["a"], down: [item("a")] },
			now,
		);
		const done = await syncIncidents(
			db,
			acct,
			{ webhookIds: [], down: [] },
			now,
		);
		expect(done.resolved).toBe(1);
	});

	test("another account is unaffected", async () => {
		const one = await makeAccount();
		const two = await makeAccount();
		await syncIncidents(db, one, { webhookIds: ["a"], down: [item("a")] }, now);
		await syncIncidents(db, two, { webhookIds: ["a"], down: [item("a")] }, now);
		await syncIncidents(db, two, { webhookIds: ["a"], down: [] }, now);
		const open = await db
			.selectFrom("webhook_incident_alerts")
			.select("account_id")
			.where("account_id", "in", [one, two])
			.where("resolved_at", "is", null)
			.execute();
		expect(open.map((r) => r.account_id)).toEqual([one]);
	});

	test("markEmailed stamps rows and purge drops only old resolved ones", async () => {
		const acct = await makeAccount();
		const { opened } = await syncIncidents(
			db,
			acct,
			{ webhookIds: ["a", "b"], down: [item("a"), item("b")] },
			now,
		);
		await markEmailed(
			db,
			opened.map((r) => r.id),
			now,
		);
		const stamped = await db
			.selectFrom("webhook_incident_alerts")
			.select("emailed_at")
			.where("account_id", "=", acct)
			.execute();
		expect(stamped.every((r) => r.emailed_at !== null)).toBe(true);

		// "a" resolved long ago, "b" still open.
		const old = new Date(now.getTime() - 100 * 86_400_000);
		await syncIncidents(
			db,
			acct,
			{ webhookIds: ["a", "b"], down: [item("b")] },
			old,
		);
		const purged = await purgeResolved(db, 90, now);
		expect(purged).toBeGreaterThanOrEqual(1);
		const left = await db
			.selectFrom("webhook_incident_alerts")
			.select("webhook_id")
			.where("account_id", "=", acct)
			.execute();
		expect(left.map((r) => r.webhook_id)).toEqual(["b"]);
	});
});
