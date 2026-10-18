import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb, sql } from "@secondlayer/shared/db";
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

async function start(clientName = "ryans-macbook", product?: string) {
	const res = await post("/api/cli/device", {
		clientName,
		...(product ? { product } : {}),
	});
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

	test("start stores product sentinel; without it the attempt has none", async () => {
		const sentinel = await start("ryans-macbook", "sentinel");
		const plain = await start();
		const rows = await db
			.selectFrom("cli_device_logins")
			.select(["user_code", "product"])
			.where("user_code", "in", [sentinel.userCode, plain.userCode])
			.execute();
		const byCode = new Map(rows.map((r) => [r.user_code, r.product]));
		expect(byCode.get(sentinel.userCode)).toBe("sentinel");
		expect(byCode.get(plain.userCode)).toBeNull();
	});

	test("an unknown product is refused (400) and stores nothing", async () => {
		const before = await db
			.selectFrom("cli_device_logins")
			.select((eb) => eb.fn.countAll<string>().as("n"))
			.executeTakeFirstOrThrow();
		for (const product of ["Sentinel", "sl", "<b>x</b>", 1, ""]) {
			const res = await post("/api/cli/device", {
				clientName: "ryans-macbook",
				product,
			});
			expect(res.status).toBe(400);
		}
		const after = await db
			.selectFrom("cli_device_logins")
			.select((eb) => eb.fn.countAll<string>().as("n"))
			.executeTakeFirstOrThrow();
		expect(after.n).toBe(before.n);
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

	const linkOf = (accountId: string) =>
		db
			.selectFrom("sentinel_accounts")
			.select("via")
			.where("account_id", "=", accountId)
			.executeTakeFirst();

	test("approving a Sentinel sign-in links the account by consent; a plain one does not", async () => {
		const account = await makeAccount();
		const session = await makeSession(account.id);

		const plain = await start();
		expect(
			(await post(`/api/cli/device/${plain.userCode}/approve`, {}, session))
				.status,
		).toBe(200);
		expect(await linkOf(account.id)).toBeUndefined();

		const d = await start("ryans-macbook", "sentinel");
		expect(
			(await post(`/api/cli/device/${d.userCode}/approve`, {}, session)).status,
		).toBe(200);
		expect(await linkOf(account.id)).toEqual({ via: "consent" });
		expect((await poll(d.deviceCode)).status).toBe(200);
	});

	test("denying a Sentinel sign-in links nothing", async () => {
		const account = await makeAccount();
		const session = await makeSession(account.id);
		const d = await start("ryans-macbook", "sentinel");
		expect(
			(await post(`/api/cli/device/${d.userCode}/deny`, {}, session)).status,
		).toBe(200);
		expect(await linkOf(account.id)).toBeUndefined();
	});

	test("an already-linked account approves again and keeps its link", async () => {
		const account = await makeAccount();
		const session = await makeSession(account.id);
		await db
			.insertInto("sentinel_accounts")
			.values({ account_id: account.id, via: "created" })
			.execute();
		for (let i = 0; i < 2; i++) {
			const d = await start("ryans-macbook", "sentinel");
			expect(
				(await post(`/api/cli/device/${d.userCode}/approve`, {}, session))
					.status,
			).toBe(200);
		}
		expect(await linkOf(account.id)).toEqual({ via: "created" });
		const n = await db
			.selectFrom("sentinel_accounts")
			.select((eb) => eb.fn.countAll<string>().as("n"))
			.where("account_id", "=", account.id)
			.executeTakeFirstOrThrow();
		expect(Number(n.n)).toBe(1);
	});

	test("the link shares the approval's transaction: a failed link leaves the code pending", async () => {
		const account = await makeAccount();
		const session = await makeSession(account.id);
		const d = await start("ryans-macbook", "sentinel");
		// Fail the link insert for this one account only.
		const fn = `cli_device_test_fail_${account.id.replace(/-/g, "")}`;
		await sql
			.raw(
				`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
				BEGIN
					IF NEW.account_id = '${account.id}' THEN RAISE EXCEPTION 'link failed'; END IF;
					RETURN NEW;
				END $$;
				CREATE TRIGGER ${fn} BEFORE INSERT ON sentinel_accounts
					FOR EACH ROW EXECUTE FUNCTION ${fn}();`,
			)
			.execute(db);
		try {
			const res = await post(
				`/api/cli/device/${d.userCode}/approve`,
				{},
				session,
			);
			expect(res.status).toBe(500);
		} finally {
			await sql
				.raw(
					`DROP TRIGGER IF EXISTS ${fn} ON sentinel_accounts; DROP FUNCTION IF EXISTS ${fn}();`,
				)
				.execute(db);
		}
		const row = await db
			.selectFrom("cli_device_logins")
			.select(["status", "account_id"])
			.where("user_code", "=", d.userCode)
			.executeTakeFirstOrThrow();
		expect(row).toEqual({ status: "pending", account_id: null });
		expect(await linkOf(account.id)).toBeUndefined();
		expect((await poll(d.deviceCode)).status).toBe(428);
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
		const body = (await res.json()) as {
			clientName: string;
			product: string | null;
			status: string;
		};
		expect(body.clientName).toBe("ryans-macbook");
		expect(body.product).toBeNull();
		expect(body.status).toBe("pending");

		const s = await start("ryans-macbook", "sentinel");
		const sres = await app.request(`/api/cli/device/${s.userCode}`, {
			headers: { authorization: `Bearer ${session}` },
		});
		expect(((await sres.json()) as { product: string }).product).toBe(
			"sentinel",
		);

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
