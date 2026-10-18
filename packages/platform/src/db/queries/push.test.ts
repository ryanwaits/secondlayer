import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	PUSH_DEFAULTS,
	deleteSubscription,
	getPushPrefs,
	listSubscriptions,
	markFailed,
	markSent,
	removeSubscription,
	saveSubscription,
	upsertPushPrefs,
} from "./push.ts";

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
	// ON DELETE CASCADE clears subscriptions and prefs.
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

const sub = (endpoint: string) => ({
	endpoint,
	p256dh: "p256",
	auth: "auth",
	userAgent: "test",
});

describe.skipIf(!HAS_DB)("push preferences", () => {
	test("an account with no row gets the defaults", async () => {
		const acct = await makeAccount();
		expect(await getPushPrefs(db, acct)).toEqual(PUSH_DEFAULTS);
	});

	test("a patch changes only the given toggles", async () => {
		const acct = await makeAccount();
		const first = await upsertPushPrefs(db, acct, { spend_cap: true });
		expect(first).toEqual({ ...PUSH_DEFAULTS, spend_cap: true });
		const second = await upsertPushPrefs(db, acct, { webhook_failing: false });
		expect(second).toEqual({
			...PUSH_DEFAULTS,
			spend_cap: true,
			webhook_failing: false,
		});
		expect(await getPushPrefs(db, acct)).toEqual(second);
	});
});

describe.skipIf(!HAS_DB)("push subscriptions", () => {
	test("the same endpoint from another account moves the row", async () => {
		const a = await makeAccount();
		const b = await makeAccount();
		const endpoint = `https://push.example/${crypto.randomUUID()}`;
		await saveSubscription(db, a, sub(endpoint));
		await saveSubscription(db, b, sub(endpoint));
		expect(await listSubscriptions(db, a)).toHaveLength(0);
		expect(await listSubscriptions(db, b)).toHaveLength(1);
	});

	test("delete only removes the caller's own endpoint", async () => {
		const a = await makeAccount();
		const b = await makeAccount();
		const endpoint = `https://push.example/${crypto.randomUUID()}`;
		await saveSubscription(db, a, sub(endpoint));
		expect(await deleteSubscription(db, b, endpoint)).toBe(0);
		expect(await listSubscriptions(db, a)).toHaveLength(1);
		expect(await deleteSubscription(db, a, endpoint)).toBe(1);
		expect(await listSubscriptions(db, a)).toHaveLength(0);
	});

	test("failures count up, a success resets them, and a gone row is removed", async () => {
		const acct = await makeAccount();
		await saveSubscription(
			db,
			acct,
			sub(`https://push.example/${crypto.randomUUID()}`),
		);
		const [row] = await listSubscriptions(db, acct);
		if (!row) throw new Error("no subscription");
		await markFailed(db, row.id);
		await markFailed(db, row.id);
		expect((await listSubscriptions(db, acct))[0]?.failed_count).toBe(2);
		const now = new Date("2026-10-18T10:00:00Z");
		await markSent(db, row.id, now);
		const after = (await listSubscriptions(db, acct))[0];
		expect(after?.failed_count).toBe(0);
		expect(after?.last_success_at?.toISOString()).toBe(now.toISOString());
		await removeSubscription(db, row.id);
		expect(await listSubscriptions(db, acct)).toHaveLength(0);
	});
});
