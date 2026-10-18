import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { saveSubscription, upsertPushPrefs } from "../db/queries/push.ts";
import { purgePushSent, pushOnce } from "./once.ts";

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
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

const env = {
	VAPID_PUBLIC_KEY: "public",
	VAPID_PRIVATE_KEY: "private",
	VAPID_SUBJECT: "mailto:ops@example.com",
};
const payload = {
	title: "t",
	body: "b",
	url: "/account/webhooks/wh_1",
	tag: "webhook:wh_1",
};
const subscribe = (acct: string) =>
	saveSubscription(db, acct, {
		endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
		p256dh: "p256",
		auth: "auth",
		userAgent: null,
	});

describe.skipIf(!HAS_DB)("pushOnce", () => {
	test("the first call sends and the same key again is a duplicate", async () => {
		const acct = await makeAccount();
		await subscribe(acct);
		let calls = 0;
		const send = async () => {
			calls++;
		};
		expect(
			await pushOnce(db, acct, "k1", "webhook_failing", payload, { env, send }),
		).toBe("sent");
		expect(
			await pushOnce(db, acct, "k1", "webhook_failing", payload, { env, send }),
		).toBe("duplicate");
		expect(calls).toBe(1);
	});

	test("a preference that is off skips and still claims the key", async () => {
		const acct = await makeAccount();
		await subscribe(acct);
		await upsertPushPrefs(db, acct, { webhook_failing: false });
		const send = async () => {};
		expect(
			await pushOnce(db, acct, "k1", "webhook_failing", payload, { env, send }),
		).toBe("skipped");
		const row = await db
			.selectFrom("push_sent")
			.select("key")
			.where("account_id", "=", acct)
			.executeTakeFirst();
		expect(row?.key).toBe("k1");
	});

	test("a delivery error still counts as sent and does not throw", async () => {
		const acct = await makeAccount();
		await subscribe(acct);
		const send = async () => {
			throw Object.assign(new Error("boom"), { statusCode: 500 });
		};
		expect(
			await pushOnce(db, acct, "k1", "webhook_failing", payload, { env, send }),
		).toBe("sent");
	});

	test("purge drops only claims older than the cutoff", async () => {
		const acct = await makeAccount();
		await db
			.insertInto("push_sent")
			.values([
				{
					account_id: acct,
					key: "old",
					kind: "replay_done",
					sent_at: new Date(Date.now() - 40 * 86_400_000),
				},
				{ account_id: acct, key: "new", kind: "replay_done" },
			])
			.execute();
		await purgePushSent(db);
		const keys = await db
			.selectFrom("push_sent")
			.select("key")
			.where("account_id", "=", acct)
			.execute();
		expect(keys.map((k) => k.key)).toEqual(["new"]);
	});
});
