import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import pushRouter from "./push.ts";

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

/** Stands in for the auth middleware: the account comes from a test header. */
function app() {
	const a = new Hono<{ Variables: { accountId: string } }>();
	a.onError(errorHandler);
	a.use("*", async (c, next) => {
		const id = c.req.header("x-test-account");
		if (id) c.set("accountId", id);
		await next();
	});
	a.route("/api/push", pushRouter);
	return a;
}

const call = (
	acct: string | null,
	method: string,
	path: string,
	body?: unknown,
) =>
	app().request(`/api/push${path}`, {
		method,
		headers: {
			"content-type": "application/json",
			...(acct ? { "x-test-account": acct } : {}),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});

const SAVED_KEY = process.env.VAPID_PUBLIC_KEY;
beforeEach(() => {
	delete process.env.VAPID_PUBLIC_KEY;
});
afterEach(() => {
	if (SAVED_KEY === undefined) {
		delete process.env.VAPID_PUBLIC_KEY;
	} else process.env.VAPID_PUBLIC_KEY = SAVED_KEY;
});

afterAll(async () => {
	if (!HAS_DB || accountIds.length === 0) return;
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

const subscription = {
	endpoint: "https://fcm.googleapis.com/fcm/send/abc",
	keys: { p256dh: "p256", auth: "auth" },
	userAgent: "test",
};

describe("push routes without an account", () => {
	test("every route answers 401", async () => {
		for (const [method, path] of [
			["GET", "/prefs"],
			["PUT", "/prefs"],
			["POST", "/subscriptions"],
			["DELETE", "/subscriptions"],
		] as const) {
			const res = await call(null, method, path, {});
			expect(res.status, `${method} ${path}`).toBe(401);
		}
	});
});

describe.skipIf(!HAS_DB)("push routes", () => {
	test("GET with no row returns the defaults and no key when VAPID is unset", async () => {
		const acct = await makeAccount();
		const res = await call(acct, "GET", "/prefs");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			publicKey: null,
			prefs: {
				webhookFailing: true,
				subgraphStopped: true,
				subgraphNotServing: true,
				replayDone: true,
				spendCap: false,
				keyRepeat: false,
			},
		});
	});

	test("GET returns the public key when it is set", async () => {
		const acct = await makeAccount();
		process.env.VAPID_PUBLIC_KEY = "public-key";
		const res = await call(acct, "GET", "/prefs");
		expect(((await res.json()) as { publicKey: string }).publicKey).toBe(
			"public-key",
		);
	});

	test("PUT changes one toggle and ignores unknown fields", async () => {
		const acct = await makeAccount();
		const res = await call(acct, "PUT", "/prefs", {
			spendCap: true,
			nonsense: 1,
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			webhookFailing: true,
			subgraphStopped: true,
			subgraphNotServing: true,
			replayDone: true,
			spendCap: true,
			keyRepeat: false,
		});
	});

	test("PUT with a non-boolean is a 400 naming the field", async () => {
		const acct = await makeAccount();
		const res = await call(acct, "PUT", "/prefs", { replayDone: "yes" });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "replayDone must be a boolean" });
	});

	test("a subscription is stored and then removed", async () => {
		const acct = await makeAccount();
		process.env.VAPID_PUBLIC_KEY = "public-key";
		const post = await call(acct, "POST", "/subscriptions", subscription);
		expect(post.status).toBe(200);
		expect(await post.json()).toEqual({ ok: true });
		const rows = await db
			.selectFrom("push_subscriptions")
			.selectAll()
			.where("account_id", "=", acct)
			.execute();
		expect(rows).toHaveLength(1);

		const del = await call(acct, "DELETE", "/subscriptions", {
			endpoint: subscription.endpoint,
		});
		expect(await del.json()).toEqual({ removed: 1 });
	});

	test("only browser push service endpoints are accepted", async () => {
		const acct = await makeAccount();
		process.env.VAPID_PUBLIC_KEY = "public-key";
		for (const endpoint of [
			"http://fcm.googleapis.com/fcm/send/abc",
			"https://evil.example/x",
			"https://fcm.googleapis.com.evil.example/x",
			"https://user:pw@fcm.googleapis.com/x",
			"https://fcm.googleapis.com:8443/x",
		]) {
			const res = await call(acct, "POST", "/subscriptions", {
				...subscription,
				endpoint,
			});
			expect(res.status, endpoint).toBe(400);
		}
		for (const endpoint of [
			"https://fcm.googleapis.com/fcm/send/abc",
			"https://web.push.apple.com/abc",
			"https://updates.push.services.mozilla.com/wpush/v2/abc",
		]) {
			const res = await call(acct, "POST", "/subscriptions", {
				...subscription,
				endpoint,
			});
			expect(res.status, endpoint).toBe(200);
		}
	});

	test("subscribing with VAPID unset is a 503", async () => {
		const acct = await makeAccount();
		const res = await call(acct, "POST", "/subscriptions", subscription);
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({
			error: "Push isn't set up on this server.",
		});
	});
});
