import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createMagicLink } from "@secondlayer/platform/db/queries/accounts";
import { getDb, sql } from "@secondlayer/shared/db";
import { hashToken } from "../auth/keys.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import { createApiApp } from "../create-app.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);

const emails: string[] = [];
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
	if (!HAS_DB || emails.length === 0) return;
	// sessions and sentinel_accounts cascade with the account
	await db.deleteFrom("accounts").where("email", "in", emails).execute();
	await db.deleteFrom("magic_links").where("email", "in", emails).execute();
});

beforeEach(async () => {
	await getRateLimitStore().clear();
});

const app = createApiApp("platform");

function freshEmail(): string {
	const email = `auth-verify-${crypto.randomUUID()}@example.com`;
	emails.push(email);
	return email;
}

async function verify(email: string, extra: Record<string, unknown> = {}) {
	const code = "123456";
	await createMagicLink(db, email, crypto.randomUUID(), code);
	return app.request("/api/auth/verify", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, code, ...extra }),
	});
}

const linkOf = (email: string) =>
	db
		.selectFrom("sentinel_accounts")
		.innerJoin("accounts", "accounts.id", "sentinel_accounts.account_id")
		.select("sentinel_accounts.via")
		.where("accounts.email", "=", email)
		.executeTakeFirst();

describe.skipIf(!HAS_DB)("POST /api/auth/verify product", () => {
	test("a new email with product sentinel is linked as created", async () => {
		const email = freshEmail();
		expect((await verify(email, { product: "sentinel" })).status).toBe(200);
		expect((await linkOf(email))?.via).toBe("created");
	});

	test("an existing account with product sentinel is not linked", async () => {
		const email = freshEmail();
		await db.insertInto("accounts").values({ email }).execute();
		expect((await verify(email, { product: "sentinel" })).status).toBe(200);
		expect(await linkOf(email)).toBeUndefined();
	});

	test("a new email without product is not linked", async () => {
		const email = freshEmail();
		expect((await verify(email)).status).toBe(200);
		expect(await linkOf(email)).toBeUndefined();
	});

	test("an unknown product is rejected", async () => {
		const res = await verify(freshEmail(), { product: "other" });
		expect(res.status).toBe(400);
	});
});

describe.skipIf(!HAS_DB)("account email identity", () => {
	test("signing in with a different case reaches the same account", async () => {
		const email = freshEmail();
		const first = await verify(email);
		const second = await verify(email.toUpperCase());
		expect(second.status).toBe(200);
		const a = (await first.json()) as { account: { id: string } };
		const b = (await second.json()) as { account: { id: string } };
		expect(b.account.id).toBe(a.account.id);
		expect(
			await db
				.selectFrom("accounts")
				.select("id")
				.where(sql<boolean>`lower(email) = ${email}`)
				.execute(),
		).toHaveLength(1);
	});

	test("a new account is stored lowercased", async () => {
		const email = freshEmail();
		const res = await verify(email.toUpperCase());
		const body = (await res.json()) as { account: { email: string } };
		expect(body.account.email).toBe(email);
	});

	test("the database refuses a second account whose email differs only in case", async () => {
		const email = freshEmail();
		await db.insertInto("accounts").values({ email }).execute();
		await expect(
			db
				.insertInto("accounts")
				.values({ email: email.toUpperCase() })
				.execute(),
		).rejects.toThrow();
	});
});

describe.skipIf(!HAS_DB)("magic link issuing", () => {
	test("a new code voids the older unused ones for that email", async () => {
		const email = freshEmail();
		await createMagicLink(db, email, crypto.randomUUID(), "111111");
		await createMagicLink(db, email, crypto.randomUUID(), "222222");
		const rows = await db
			.selectFrom("magic_links")
			.select(["code", "used_at"])
			.where("email", "=", email)
			.execute();
		expect(rows.find((r) => r.code === "111111")?.used_at).not.toBeNull();
		expect(rows.find((r) => r.code === "222222")?.used_at).toBeNull();
	});

	test("an older code no longer signs in once a newer one was issued", async () => {
		const email = freshEmail();
		await createMagicLink(db, email, crypto.randomUUID(), "111111");
		await createMagicLink(db, email, crypto.randomUUID(), "222222");
		const stale = await app.request("/api/auth/verify", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, code: "111111" }),
		});
		expect(stale.status).toBe(400);
	});
});

describe.skipIf(!HAS_DB)("POST /api/auth/logout", () => {
	test("a second logout keeps the first revoked_at", async () => {
		const email = freshEmail();
		const res = await verify(email);
		const { sessionToken } = (await res.json()) as { sessionToken: string };
		const logout = () =>
			app.request("/api/auth/logout", {
				method: "POST",
				headers: {
					authorization: `Bearer ${sessionToken}`,
					"content-type": "application/json",
				},
			});
		const read = () =>
			db
				.selectFrom("sessions")
				.select("revoked_at")
				.where("token_hash", "=", hashToken(sessionToken))
				.executeTakeFirstOrThrow();
		expect((await logout()).status).toBe(200);
		const first = (await read()).revoked_at;
		expect(first).not.toBeNull();
		await Bun.sleep(20);
		await logout();
		expect((await read()).revoked_at?.getTime()).toBe(first?.getTime());
	});
});
