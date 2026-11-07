import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	GHOST_ACCOUNT_ROWS_LIMIT,
	ROWS_DELIVERED_MONTHLY_ALLOWANCE,
} from "@secondlayer/platform/billing/prices";
import { getDb } from "@secondlayer/shared/db";
import { hashToken } from "../auth/keys.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import { createApiApp } from "../create-app.ts";
import { checkRowsAllowance } from "../lib/read-credits.ts";

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
	// Cascades to the keys and ledger rows.
	await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

beforeEach(async () => {
	await getRateLimitStore().clear();
});

const app = createApiApp("platform");

function mintFrom(ip: string) {
	return app.request("/api/public/docs-key", {
		method: "POST",
		headers: { "content-type": "application/json", "x-forwarded-for": ip },
		body: "{}",
	});
}

/** A ghost-owned docs key and its account id. */
async function anonKey(ip = "203.0.113.7") {
	const res = await mintFrom(ip);
	expect(res.status).toBe(201);
	const body = (await res.json()) as {
		key: string;
		prefix: string;
		expiresAt: string;
	};
	const row = await db
		.selectFrom("api_keys")
		.select(["account_id", "product", "status", "expires_at"])
		.where("key_hash", "=", hashToken(body.key))
		.executeTakeFirstOrThrow();
	accountIds.push(row.account_id);
	return { ...body, row };
}

let ipSeq = 0;
const freshIp = () => `198.51.100.${++ipSeq}`;

async function addRows(accountId: string, rows: number, occurredAt?: Date) {
	await db
		.insertInto("usage_ledger")
		.values({
			account_id: accountId,
			unit: "rows.delivered",
			quantity: rows,
			usd_micros: 0,
			source: "test",
			api_key_id: null,
			observed_quantity: null,
			idempotency_key: crypto.randomUUID(),
			...(occurredAt ? { occurred_at: occurredAt } : {}),
		})
		.execute();
}

describe.skipIf(!HAS_DB)("signed-out docs key", () => {
	test("mints a 24 hour docs key owned by a new ghost account, never cached", async () => {
		const res = await mintFrom(freshIp());
		expect(res.status).toBe(201);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const body = (await res.json()) as {
			key: string;
			prefix: string;
			expiresAt: string;
		};
		expect(body.key.startsWith(body.prefix)).toBe(true);
		const hours = (Date.parse(body.expiresAt) - Date.now()) / 3_600_000;
		expect(hours).toBeGreaterThan(23.9);
		expect(hours).toBeLessThanOrEqual(24);

		const key = await db
			.selectFrom("api_keys")
			.select(["account_id", "product", "status", "name"])
			.where("key_hash", "=", hashToken(body.key))
			.executeTakeFirstOrThrow();
		accountIds.push(key.account_id);
		expect(key.product).toBe("docs");
		expect(key.status).toBe("active");
		const owner = await db
			.selectFrom("accounts")
			.select(["ghost", "email"])
			.where("id", "=", key.account_id)
			.executeTakeFirstOrThrow();
		expect(owner).toEqual({ ghost: true, email: null });
	});

	test("each mint gets its own ghost account", async () => {
		const a = await anonKey(freshIp());
		const b = await anonKey(freshIp());
		expect(a.row.account_id).not.toBe(b.row.account_id);
	});

	test("the key reads Streams and Index", async () => {
		const { key } = await anonKey(freshIp());
		for (const path of ["/v1/streams/tip", "/v1/index/blocks"]) {
			const res = await app.request(path, {
				headers: { authorization: `Bearer ${key}` },
			});
			// Auth passed: whatever the handler does next, not an auth refusal.
			expect([401, 403]).not.toContain(res.status);
		}
	});

	test("a second mint from the same IP the same day gets 429 with Retry-After", async () => {
		const ip = freshIp();
		await anonKey(ip);
		const again = await mintFrom(ip);
		expect(again.status).toBe(429);
		expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(0);
		// Another reader is unaffected.
		expect((await mintFrom(freshIp())).status).toBe(201);
	});

	test("the key cannot write: creating a key with it is 403", async () => {
		const { key, row } = await anonKey(freshIp());
		const res = await app.request("/api/keys", {
			method: "POST",
			headers: {
				authorization: `Bearer ${key}`,
				"content-type": "application/json",
			},
			body: "{}",
		});
		expect(res.status).toBe(403);
		const keys = await db
			.selectFrom("api_keys")
			.select("product")
			.where("account_id", "=", row.account_id)
			.execute();
		expect(keys.map((k) => k.product)).toEqual(["docs"]);
	});
});

describe.skipIf(!HAS_DB)("ghost account rows limit", () => {
	test("a ghost under its rows reads; at the limit it is refused with the sign-up pointer", async () => {
		const { row } = await anonKey(freshIp());
		await addRows(row.account_id, GHOST_ACCOUNT_ROWS_LIMIT - 1);
		expect(await checkRowsAllowance(row.account_id, "free")).toBeNull();
		await addRows(row.account_id, 1);
		expect(await checkRowsAllowance(row.account_id, "free")).toEqual({
			error: "rows_limit_reached",
			message:
				"This docs key has read its 100,000 rows. Make a lasting key at https://secondlayer.tools/signin.",
		});
	});

	test("a ghost past its rows gets 402 on a Streams read", async () => {
		const { key, row } = await anonKey(freshIp());
		await addRows(row.account_id, GHOST_ACCOUNT_ROWS_LIMIT);
		const res = await app.request("/v1/streams/events", {
			headers: { authorization: `Bearer ${key}` },
		});
		expect(res.status).toBe(402);
		expect(((await res.json()) as { error: string }).error).toBe(
			"rows_limit_reached",
		);
	});

	test("rows read last month count when the month has just turned", async () => {
		const { row } = await anonKey(freshIp());
		const monthStart = new Date(Date.UTC(2026, 11, 1));
		await addRows(
			row.account_id,
			GHOST_ACCOUNT_ROWS_LIMIT / 2,
			new Date(monthStart.getTime() - 3_600_000),
		);
		await addRows(
			row.account_id,
			GHOST_ACCOUNT_ROWS_LIMIT / 2,
			new Date(monthStart.getTime() + 600_000),
		);
		const now = new Date(monthStart.getTime() + 3_600_000);
		expect((await checkRowsAllowance(row.account_id, "free", now))?.error).toBe(
			"rows_limit_reached",
		);
	});

	test("an account with an email keeps the monthly allowance past the ghost limit", async () => {
		const account = await db
			.insertInto("accounts")
			.values({ email: `ghost-limit-${crypto.randomUUID()}@example.com` })
			.returning("id")
			.executeTakeFirstOrThrow();
		accountIds.push(account.id);
		await addRows(account.id, GHOST_ACCOUNT_ROWS_LIMIT * 2);
		expect(GHOST_ACCOUNT_ROWS_LIMIT * 2).toBeLessThan(
			ROWS_DELIVERED_MONTHLY_ALLOWANCE,
		);
		expect(await checkRowsAllowance(account.id, "free")).toBeNull();
	});
});
