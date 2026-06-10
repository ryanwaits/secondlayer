import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createMagicLink } from "@secondlayer/platform/db/queries/accounts";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import {
	consumeClaimToken,
	createClaimToken,
	generateClaimToken,
	validateClaimToken,
} from "../src/auth/ghost.ts";
import { hashToken } from "../src/auth/keys.ts";
import { errorHandler } from "../src/middleware/error.ts";
import authRouter from "../src/routes/auth.ts";

/**
 * Claim-token validation + the /api/auth/claim/verify attach/merge flows,
 * against the real DB. Phase 1 (magic-link send) is skipped — verify consumes
 * a magic_links row seeded directly via createMagicLink, which is exactly what
 * phase 1 writes.
 */

const db = getDb();
const createdAccountIds: string[] = [];
const createdEmails: string[] = [];

async function makeGhost(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: null, ghost: true })
		.returning("id")
		.executeTakeFirstOrThrow();
	createdAccountIds.push(row.id);
	return row.id;
}

function uniqueEmail(tag: string): string {
	const email = `ghost-test-${tag}-${crypto.randomUUID().slice(0, 8)}@example.com`;
	createdEmails.push(email);
	return email;
}

async function seedMagicLink(email: string): Promise<string> {
	const code = String(
		crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000,
	).padStart(6, "0");
	const token = crypto.randomUUID().replaceAll("-", "");
	await createMagicLink(db, email, token, code);
	return code;
}

function buildApp(): Hono {
	const app = new Hono();
	app.onError(errorHandler);
	app.route("/api/auth", authRouter);
	return app;
}

async function claimVerify(
	app: Hono,
	body: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const res = await app.request("/api/auth/claim/verify", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			// Distinct IP per call dodges the route's per-IP verify limiter.
			"x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
		},
		body: JSON.stringify(body),
	});
	return {
		status: res.status,
		body: (await res.json()) as Record<string, unknown>,
	};
}

beforeAll(() => {
	process.env.DEV_MODE = "false";
});

afterAll(async () => {
	if (createdEmails.length > 0) {
		await db
			.deleteFrom("magic_links")
			.where("email", "in", createdEmails)
			.execute();
		await db
			.deleteFrom("accounts")
			.where("email", "in", createdEmails)
			.execute();
	}
	if (createdAccountIds.length > 0) {
		await db
			.deleteFrom("accounts")
			.where("id", "in", createdAccountIds)
			.execute();
	}
});

describe("claim token validation", () => {
	test("valid token resolves; consume is single-use", async () => {
		const ghostId = await makeGhost();
		const { raw } = await createClaimToken(db, ghostId);

		const valid = await validateClaimToken(db, raw);
		expect(valid?.accountId).toBe(ghostId);

		expect(await consumeClaimToken(db, raw)).toBe(ghostId);
		// Burned: both validate and a second consume refuse.
		expect(await validateClaimToken(db, raw)).toBeNull();
		expect(await consumeClaimToken(db, raw)).toBeNull();
	});

	test("expired token is rejected", async () => {
		const ghostId = await makeGhost();
		const { raw, hash } = generateClaimToken();
		await db
			.insertInto("claim_tokens")
			.values({
				account_id: ghostId,
				token_hash: hash,
				expires_at: new Date(Date.now() - 1000),
			})
			.execute();
		expect(await validateClaimToken(db, raw)).toBeNull();
		expect(await consumeClaimToken(db, raw)).toBeNull();
	});

	test("unknown token is rejected", async () => {
		expect(await validateClaimToken(db, "no-such-token")).toBeNull();
	});

	test("token for a non-ghost (already claimed) account fails validate", async () => {
		const ghostId = await makeGhost();
		const { raw } = await createClaimToken(db, ghostId);
		await db
			.updateTable("accounts")
			.set({ ghost: false, email: uniqueEmail("claimed") })
			.where("id", "=", ghostId)
			.execute();
		expect(await validateClaimToken(db, raw)).toBeNull();
	});
});

describe("POST /api/auth/claim/verify", () => {
	test("attach: new email becomes the ghost account's email, ghost=false", async () => {
		const app = buildApp();
		const ghostId = await makeGhost();
		const { raw } = await createClaimToken(db, ghostId);
		const email = uniqueEmail("attach");
		const code = await seedMagicLink(email);

		const { status, body } = await claimVerify(app, {
			token: raw,
			email,
			code,
		});
		expect(status).toBe(200);
		expect(typeof body.sessionToken).toBe("string");
		expect((body.account as { id: string }).id).toBe(ghostId);

		const account = await db
			.selectFrom("accounts")
			.select(["email", "ghost"])
			.where("id", "=", ghostId)
			.executeTakeFirstOrThrow();
		expect(account.email).toBe(email);
		expect(account.ghost).toBe(false);
	});

	test("merge: existing email absorbs the ghost's keys; ghost deleted", async () => {
		const app = buildApp();
		const email = uniqueEmail("merge");
		const existing = await db
			.insertInto("accounts")
			.values({ email, ghost: false })
			.returning("id")
			.executeTakeFirstOrThrow();

		const ghostId = await makeGhost();
		const key = await db
			.insertInto("api_keys")
			.values({
				key_hash: hashToken(`sk-sl_${crypto.randomUUID()}`),
				key_prefix: "sk-sl_test",
				account_id: ghostId,
				ip_address: "test",
				product: "account",
				tier: "free",
				status: "active",
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		const { raw } = await createClaimToken(db, ghostId);
		const code = await seedMagicLink(email);

		const { status, body } = await claimVerify(app, {
			token: raw,
			email,
			code,
		});
		expect(status).toBe(200);
		expect((body.account as { id: string }).id).toBe(existing.id);

		const movedKey = await db
			.selectFrom("api_keys")
			.select("account_id")
			.where("id", "=", key.id)
			.executeTakeFirstOrThrow();
		expect(movedKey.account_id).toBe(existing.id);

		const ghost = await db
			.selectFrom("accounts")
			.select("id")
			.where("id", "=", ghostId)
			.executeTakeFirst();
		expect(ghost).toBeUndefined();
	});

	test("used claim token is refused even with a fresh code", async () => {
		const app = buildApp();
		const ghostId = await makeGhost();
		const { raw } = await createClaimToken(db, ghostId);
		await consumeClaimToken(db, raw);

		const email = uniqueEmail("reuse");
		const code = await seedMagicLink(email);
		const { status } = await claimVerify(app, { token: raw, email, code });
		expect(status).toBe(400);
	});
});
