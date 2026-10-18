import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import {
	listSubscriptions,
	saveSubscription,
	upsertPushPrefs,
} from "../db/queries/push.ts";
import { type PushTarget, sendPush } from "./send.ts";

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
	title: "A webhook is failing",
	body: "orders stopped answering",
	url: "/account/webhooks/wh_1",
	tag: "webhook-wh_1",
};
const subscribe = (acct: string, name: string) =>
	saveSubscription(db, acct, {
		endpoint: `https://fcm.googleapis.com/fcm/send/${name}-${crypto.randomUUID()}`,
		p256dh: "p256",
		auth: "auth",
		userAgent: null,
	});

describe.skipIf(!HAS_DB)("sendPush", () => {
	test("with the VAPID env unset it skips and sends nothing", async () => {
		const acct = await makeAccount();
		await subscribe(acct, "a");
		let calls = 0;
		const result = await sendPush(db, acct, "webhook_failing", payload, {
			env: {},
			send: async () => {
				calls++;
			},
		});
		expect(result).toEqual({ skipped: "unconfigured" });
		expect(calls).toBe(0);
	});

	test("a kind that is turned off is skipped", async () => {
		const acct = await makeAccount();
		await subscribe(acct, "a");
		await upsertPushPrefs(db, acct, { webhook_failing: false });
		const result = await sendPush(db, acct, "webhook_failing", payload, {
			env,
			send: async () => {},
		});
		expect(result).toEqual({ skipped: "pref_off" });
	});

	test("an account with no devices is skipped", async () => {
		const acct = await makeAccount();
		const result = await sendPush(db, acct, "webhook_failing", payload, {
			env,
			send: async () => {},
		});
		expect(result).toEqual({ skipped: "no_subscriptions" });
	});

	test("every device gets the payload and is marked delivered", async () => {
		const acct = await makeAccount();
		await subscribe(acct, "a");
		await subscribe(acct, "b");
		const bodies: string[] = [];
		const now = new Date("2026-10-18T10:00:00Z");
		const result = await sendPush(db, acct, "webhook_failing", payload, {
			env,
			now,
			send: async (_sub: PushTarget, body: string) => {
				bodies.push(body);
			},
		});
		expect(result).toEqual({ sent: 2, failed: 0, removed: 0 });
		for (const body of bodies) {
			expect(JSON.parse(body)).toMatchObject({
				title: payload.title,
				url: payload.url,
				tag: payload.tag,
			});
		}
		const rows = await listSubscriptions(db, acct);
		for (const row of rows) {
			expect(row.last_success_at?.toISOString()).toBe(now.toISOString());
		}
	});

	test("a gone device (410) is removed and the other still gets it", async () => {
		const acct = await makeAccount();
		await subscribe(acct, "gone");
		await subscribe(acct, "ok");
		const result = await sendPush(db, acct, "webhook_failing", payload, {
			env,
			send: async (sub) => {
				if (sub.endpoint.includes("/gone-")) {
					throw Object.assign(new Error("gone"), { statusCode: 410 });
				}
			},
		});
		expect(result).toEqual({ sent: 1, failed: 0, removed: 1 });
		const rows = await listSubscriptions(db, acct);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.endpoint).toContain("/ok-");
	});

	test("a stored endpoint that is not a push service is removed and never called", async () => {
		const acct = await makeAccount();
		await saveSubscription(db, acct, {
			endpoint: "https://169.254.169.254/latest/meta-data",
			p256dh: "p256",
			auth: "auth",
			userAgent: null,
		});
		await subscribe(acct, "ok");
		const called: string[] = [];
		const result = await sendPush(db, acct, "webhook_failing", payload, {
			env,
			send: async (sub) => {
				called.push(sub.endpoint);
			},
		});
		expect(result).toEqual({ sent: 1, failed: 0, removed: 1 });
		expect(called).toHaveLength(1);
		expect(called[0]).toContain("fcm.googleapis.com");
		expect(await listSubscriptions(db, acct)).toHaveLength(1);
	});

	test("a server error counts a failure and does not throw", async () => {
		const acct = await makeAccount();
		await subscribe(acct, "a");
		const result = await sendPush(db, acct, "webhook_failing", payload, {
			env,
			send: async () => {
				throw Object.assign(new Error("boom"), { statusCode: 500 });
			},
		});
		expect(result).toEqual({ sent: 0, failed: 1, removed: 0 });
		expect((await listSubscriptions(db, acct))[0]?.failed_count).toBe(1);
	});
});
