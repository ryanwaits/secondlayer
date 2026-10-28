import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createMagicLink } from "@secondlayer/platform/db/queries/accounts";
import { getDb } from "@secondlayer/shared/db";
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
