import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { generateSessionToken, hashToken } from "../auth/keys.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import { createApiApp } from "../create-app.ts";
import { generateUserCode, normalizeUserCode } from "./cli-device.ts";

describe("user codes", () => {
	test("generated codes are XXXX-XXXX from the no-vowel alphabet", () => {
		for (let i = 0; i < 200; i++) {
			expect(generateUserCode()).toMatch(
				/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
			);
		}
	});

	test("typed codes normalize; malformed ones are rejected", () => {
		expect(normalizeUserCode("wdjb-mjht")).toBe("WDJB-MJHT");
		expect(normalizeUserCode("wdjb mjht")).toBe("WDJB-MJHT");
		expect(normalizeUserCode("WDJBMJHT")).toBe("WDJB-MJHT");
		expect(normalizeUserCode("WDJB-MJH")).toBeNull();
		expect(normalizeUserCode("AEIO-AEIO")).toBeNull();
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const accountIds: string[] = [];
let prevMode: string | undefined;
let prevDev: string | undefined;

beforeAll(() => {
	prevMode = process.env.INSTANCE_MODE;
	prevDev = process.env.DEV_MODE;
	process.env.INSTANCE_MODE = "platform";
	process.env.DEV_MODE = "false";
});

afterAll(async () => {
	const restore = (k: string, v: string | undefined) => {
		if (v === undefined) Reflect.deleteProperty(process.env, k);
		else process.env[k] = v;
	};
	restore("INSTANCE_MODE", prevMode);
	restore("DEV_MODE", prevDev);
	if (!HAS_DB || accountIds.length === 0) return;
	// cli_device_logins cascade with the account
	await db
		.deleteFrom("sessions")
		.where("account_id", "in", accountIds)
		.execute();
	await db
		.deleteFrom("api_keys")
		.where("account_id", "in", accountIds)
		.execute();
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

beforeEach(async () => {
	await getRateLimitStore().clear();
});

async function makeAccount(): Promise<{ id: string; email: string }> {
	const email = `cli-device-${crypto.randomUUID()}@example.com`;
	const row = await db
		.insertInto("accounts")
		.values({ email })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return { id: row.id, email };
}

async function makeSession(accountId: string): Promise<string> {
	const { raw, hash, prefix } = generateSessionToken();
	await db
		.insertInto("sessions")
		.values({
			token_hash: hash,
			token_prefix: prefix,
			account_id: accountId,
			ip_address: "test",
		})
		.execute();
	return raw;
}

async function makeAccountKey(accountId: string): Promise<string> {
	const raw = `sk-sl_cli_device_${crypto.randomUUID()}`;
	await db
		.insertInto("api_keys")
		.values({
			key_hash: hashToken(raw),
			key_prefix: raw.slice(0, 14),
			account_id: accountId,
			ip_address: "test",
			product: "account",
			tier: "free",
			status: "active",
		})
		.execute();
	return raw;
}

const app = createApiApp("platform");

function post(path: string, body: unknown, bearer?: string) {
	return app.request(path, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
		},
		body: JSON.stringify(body),
	});
}

async function start(clientName = "ryans-macbook") {
	const res = await post("/api/cli/device", { clientName });
	expect(res.status).toBe(200);
	return (await res.json()) as {
		deviceCode: string;
		userCode: string;
		verificationUrl: string;
		interval: number;
		expiresIn: number;
	};
}

const poll = (deviceCode: string) =>
	post("/api/cli/device/token", { deviceCode });

describe.skipIf(!HAS_DB)("CLI device login", () => {
	test("start returns a well-formed code and a verification link", async () => {
		const d = await start();
		expect(d.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
		expect(d.verificationUrl).toContain(`/cli/login?code=${d.userCode}`);
		expect(d.interval).toBe(5);
		expect(d.expiresIn).toBe(900);
		const row = await db
			.selectFrom("cli_device_logins")
			.selectAll()
			.where("user_code", "=", d.userCode)
			.executeTakeFirstOrThrow();
		expect(row.device_code_hash).toBe(hashToken(d.deviceCode));
		expect(row.device_code_hash).not.toBe(d.deviceCode);
	});

	test("polling before approval is pending (428)", async () => {
		const d = await start();
		const res = await poll(d.deviceCode);
		expect(res.status).toBe(428);
		expect(((await res.json()) as { error: string }).error).toBe(
			"authorization_pending",
		);
	});

	test("an unknown device code is expired (410)", async () => {
		expect((await poll("0".repeat(64))).status).toBe(410);
	});

	test("approve then poll opens a session that authenticates, once, and makes no API key", async () => {
		const account = await makeAccount();
		const session = await makeSession(account.id);
		const d = await start("ryans-macbook");

		const approve = await post(
			`/api/cli/device/${d.userCode}/approve`,
			{},
			session,
		);
		expect(approve.status).toBe(200);

		const res = await poll(d.deviceCode);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			sessionToken: string;
			key: string;
			account: { id: string; email: string };
		};
		expect(body.account).toEqual({ id: account.id, email: account.email });
		expect(body.sessionToken.startsWith("ss-sl_")).toBe(true);
		// CLI 21.3.0 reads `key`; it carries the same session token.
		expect(body.key).toBe(body.sessionToken);

		const row = await db
			.selectFrom("sessions")
			.select(["account_id", "revoked_at"])
			.where("token_hash", "=", hashToken(body.sessionToken))
			.executeTakeFirstOrThrow();
		expect(row).toEqual({ account_id: account.id, revoked_at: null });

		const keys = await db
			.selectFrom("api_keys")
			.select((eb) => eb.fn.countAll<string>().as("n"))
			.where("account_id", "=", account.id)
			.executeTakeFirstOrThrow();
		expect(Number(keys.n)).toBe(0);

		const me = await app.request("/api/accounts/me", {
			headers: { authorization: `Bearer ${body.sessionToken}` },
		});
		expect(me.status).toBe(200);

		expect((await poll(d.deviceCode)).status).toBe(410);
	});

	test("deny makes the next poll 403", async () => {
		const account = await makeAccount();
		const session = await makeSession(account.id);
		const d = await start();
		const deny = await post(`/api/cli/device/${d.userCode}/deny`, {}, session);
		expect(deny.status).toBe(200);
		const res = await poll(d.deviceCode);
		expect(res.status).toBe(403);
		expect(((await res.json()) as { error: string }).error).toBe(
			"access_denied",
		);
	});

	test("an expired attempt is 410 even when approved", async () => {
		const account = await makeAccount();
		const session = await makeSession(account.id);
		const d = await start();
		await post(`/api/cli/device/${d.userCode}/approve`, {}, session);
		await db
			.updateTable("cli_device_logins")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("user_code", "=", d.userCode)
			.execute();
		expect((await poll(d.deviceCode)).status).toBe(410);
		const approve = await post(
			`/api/cli/device/${d.userCode}/approve`,
			{},
			session,
		);
		expect(approve.status).toBe(404);
	});

	test("an API key cannot approve (403)", async () => {
		const account = await makeAccount();
		const apiKey = await makeAccountKey(account.id);
		const d = await start();
		const res = await post(`/api/cli/device/${d.userCode}/approve`, {}, apiKey);
		expect(res.status).toBe(403);
		expect((await poll(d.deviceCode)).status).toBe(428);
	});

	test("approving twice is a conflict", async () => {
		const account = await makeAccount();
		const session = await makeSession(account.id);
		const d = await start();
		const url = `/api/cli/device/${d.userCode}/approve`;
		expect((await post(url, {}, session)).status).toBe(200);
		expect((await post(url, {}, session)).status).toBe(409);
	});

	test("the approval page reads the attempt with a session only", async () => {
		const account = await makeAccount();
		const session = await makeSession(account.id);
		const d = await start("ryans-macbook");
		const res = await app.request(`/api/cli/device/${d.userCode}`, {
			headers: { authorization: `Bearer ${session}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { clientName: string; status: string };
		expect(body.clientName).toBe("ryans-macbook");
		expect(body.status).toBe("pending");

		const missing = await app.request("/api/cli/device/BCDF-GHJK", {
			headers: { authorization: `Bearer ${session}` },
		});
		expect(missing.status).toBe(404);
		const anon = await app.request(`/api/cli/device/${d.userCode}`);
		expect(anon.status).toBe(401);
	});

	test("polling does not eat the sign-in limiter's budget", async () => {
		const d = await start();
		for (let i = 0; i < 15; i++) await poll(d.deviceCode);
		const res = await post("/api/auth/magic-link", { email: "nobody@example" });
		expect(res.status).not.toBe(429);
	});
});
