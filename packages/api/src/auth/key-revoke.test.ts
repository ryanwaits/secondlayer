import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { createApiApp } from "../create-app.ts";
import { generateSessionToken, hashToken } from "./keys.ts";
import { getRateLimitStore } from "./rate-limit-store.ts";

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

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
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

async function makeKey(
	accountId: string,
	opts: {
		product?: "account" | "docs" | "tenant" | "sentinel";
		revokedAt?: Date;
	} = {},
): Promise<string> {
	const raw = `sk-sl_revoke_${crypto.randomUUID()}`;
	const row = await db
		.insertInto("api_keys")
		.values({
			key_hash: hashToken(raw),
			key_prefix: raw.slice(0, 14),
			account_id: accountId,
			name: "Production",
			ip_address: "test",
			product: opts.product ?? "account",
			tier: "free",
			status: opts.revokedAt ? "revoked" : "active",
			revoked_at: opts.revokedAt ?? null,
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	return row.id;
}

async function rowById(id: string) {
	return db
		.selectFrom("api_keys")
		.selectAll()
		.where("id", "=", id)
		.executeTakeFirstOrThrow();
}

const app = createApiApp("platform");

function revoke(token: string, id: string) {
	return app.request(`/api/keys/${id}`, {
		method: "DELETE",
		headers: { authorization: `Bearer ${token}` },
	});
}

describe.skipIf(!HAS_DB)("DELETE /api/keys/:id", () => {
	test("revokes an active account key", async () => {
		const accountId = await makeAccount();
		const id = await makeKey(accountId);
		const res = await revoke(await makeSession(accountId), id);
		expect(res.status).toBe(200);
		const row = await rowById(id);
		expect(row.status).toBe("revoked");
		expect(row.revoked_at).not.toBeNull();
	});

	test("a customer cannot revoke tenant or sentinel keys", async () => {
		const accountId = await makeAccount();
		const session = await makeSession(accountId);
		for (const product of ["tenant", "sentinel"] as const) {
			const id = await makeKey(accountId, { product });
			const res = await revoke(session, id);
			expect(res.status).toBe(409);
			expect((await rowById(id)).status).toBe("active");
		}
	});

	test("revoking an already-revoked key keeps its original revoked_at", async () => {
		const accountId = await makeAccount();
		const revokedAt = new Date("2026-01-01T00:00:00.000Z");
		const id = await makeKey(accountId, { revokedAt });
		const res = await revoke(await makeSession(accountId), id);
		expect(res.status).toBe(200);
		expect((await rowById(id)).revoked_at?.toISOString()).toBe(
			revokedAt.toISOString(),
		);
	});
});
