import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getDb, sql } from "@secondlayer/shared/db";
import {
	OAUTH_ACCESS_PREFIX,
	OAUTH_REFRESH_PREFIX,
	OAUTH_TTL,
	approveOauthRequest,
	createOauthRequest,
	denyOauthRequest,
	exchangeOauthCode,
	getOpenOauthRequest,
	hashOauthSecret,
	listOauthGrants,
	pkceMatches,
	purgeOauth,
	refreshOauthTokens,
	registerOauthClient,
	resolveOauthAccessToken,
	revokeOauthGrant,
} from "./oauth.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const accountIds: string[] = [];
const clientIds: string[] = [];

const REDIRECT = "http://127.0.0.1:53682/callback";
const RESOURCE = "https://api.test/mcp";
const VERIFIER = `v${"x".repeat(42)}${crypto.randomUUID().replace(/-/g, "")}`;
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

afterAll(async () => {
	if (!HAS_DB) return;
	if (clientIds.length)
		await db.deleteFrom("oauth_clients").where("id", "in", clientIds).execute();
	if (accountIds.length)
		await db.deleteFrom("accounts").where("id", "in", accountIds).execute();
});

async function makeAccount(): Promise<string> {
	const row = await db
		.insertInto("accounts")
		.values({ email: `oauth-${crypto.randomUUID()}@example.com` })
		.returning("id")
		.executeTakeFirstOrThrow();
	accountIds.push(row.id);
	return row.id;
}

async function makeClient(): Promise<string> {
	const { id } = await registerOauthClient(db, {
		name: "Claude Code",
		redirectUris: [REDIRECT],
		ip: "203.0.113.1",
	});
	clientIds.push(id);
	return id;
}

/** Register, authorize and approve: a fresh code for a fresh account. */
async function approvedCode() {
	const accountId = await makeAccount();
	const clientId = await makeClient();
	const requestId = await createOauthRequest(db, {
		clientId,
		redirectUri: REDIRECT,
		state: "st",
		codeChallenge: CHALLENGE,
		resource: RESOURCE,
	});
	const approved = await approveOauthRequest(db, requestId, accountId);
	if (!approved) throw new Error("not approved");
	return { accountId, clientId, requestId, code: approved.code };
}

const exchange = (
	clientId: string,
	code: string,
	over: Partial<Parameters<typeof exchangeOauthCode>[1]> = {},
) =>
	exchangeOauthCode(db, {
		code,
		clientId,
		redirectUri: REDIRECT,
		codeVerifier: VERIFIER,
		resource: RESOURCE,
		...over,
	});

async function tokensFor() {
	const c = await approvedCode();
	const r = await exchange(c.clientId, c.code);
	if (!r.ok) throw new Error(r.error.error_description);
	return { ...c, tokens: r.tokens };
}

test("PKCE S256 matches only the verifier that made the challenge", () => {
	expect(pkceMatches(VERIFIER, CHALLENGE)).toBe(true);
	expect(pkceMatches(`${VERIFIER}x`, CHALLENGE)).toBe(false);
	// `plain` would compare the verifier itself: never accepted.
	expect(pkceMatches(VERIFIER, VERIFIER)).toBe(false);
});

describe.skipIf(!HAS_DB)("oauth store", () => {
	test("a request is open until answered; it can be answered once", async () => {
		const accountId = await makeAccount();
		const clientId = await makeClient();
		const id = await createOauthRequest(db, {
			clientId,
			redirectUri: REDIRECT,
			state: null,
			codeChallenge: CHALLENGE,
			resource: RESOURCE,
		});
		expect((await getOpenOauthRequest(db, id))?.clientName).toBe("Claude Code");
		expect(await denyOauthRequest(db, id, accountId)).toEqual({
			redirectUri: REDIRECT,
			state: null,
		});
		expect(await getOpenOauthRequest(db, id)).toBeNull();
		expect(await approveOauthRequest(db, id, accountId)).toBeNull();
	});

	test("an expired request can't be approved", async () => {
		const accountId = await makeAccount();
		const clientId = await makeClient();
		const id = await createOauthRequest(db, {
			clientId,
			redirectUri: REDIRECT,
			state: null,
			codeChallenge: CHALLENGE,
			resource: RESOURCE,
		});
		await db
			.updateTable("oauth_requests")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("id", "=", id)
			.execute();
		expect(await getOpenOauthRequest(db, id)).toBeNull();
		expect(await approveOauthRequest(db, id, accountId)).toBeNull();
	});

	test("the code gives prefixed tokens stored only as hashes", async () => {
		const { tokens, code } = await tokensFor();
		expect(tokens.access_token).toStartWith(OAUTH_ACCESS_PREFIX);
		expect(tokens.refresh_token).toStartWith(OAUTH_REFRESH_PREFIX);
		expect(tokens.expires_in).toBe(OAUTH_TTL.accessSeconds);
		expect(tokens.scope).toBe("mcp");
		const stored = await db
			.selectFrom("oauth_tokens")
			.select("token_hash")
			.where("token_hash", "in", [
				tokens.access_token,
				tokens.refresh_token,
				hashOauthSecret(tokens.access_token),
				hashOauthSecret(tokens.refresh_token),
			])
			.execute();
		expect(stored.map((r) => r.token_hash).sort()).toEqual(
			[
				hashOauthSecret(tokens.access_token),
				hashOauthSecret(tokens.refresh_token),
			].sort(),
		);
		const codeRow = await db
			.selectFrom("oauth_codes")
			.select("code_hash")
			.where("code_hash", "in", [code, hashOauthSecret(code)])
			.execute();
		expect(codeRow).toEqual([{ code_hash: hashOauthSecret(code) }]);
	});

	test("the access token resolves to the account and grant", async () => {
		const { tokens, accountId } = await tokensFor();
		const g = await resolveOauthAccessToken(db, tokens.access_token);
		expect(g?.accountId).toBe(accountId);
		// The refresh token is never an access token.
		expect(await resolveOauthAccessToken(db, tokens.refresh_token)).toBeNull();
		expect(await resolveOauthAccessToken(db, "oat-sl_nope")).toBeNull();
	});

	test("a wrong verifier, client, redirect or resource is refused and the code stays unused", async () => {
		const c = await approvedCode();
		const other = await makeClient();
		for (const over of [
			{ codeVerifier: `${VERIFIER}x` },
			{ codeVerifier: VERIFIER.slice(1) },
			{ clientId: other },
			{ redirectUri: `${REDIRECT}/x` },
		]) {
			const r = await exchange(c.clientId, c.code, over);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.error).toBe("invalid_grant");
		}
		const target = await exchange(c.clientId, c.code, {
			resource: "https://evil.test/mcp",
		});
		expect(!target.ok && target.error.error).toBe("invalid_target");
		expect((await exchange(c.clientId, c.code)).ok).toBe(true);
	});

	test("a code works once; using it again revokes the grant it made", async () => {
		const c = await approvedCode();
		const first = await exchange(c.clientId, c.code);
		if (!first.ok) throw new Error("first exchange failed");
		expect(
			await resolveOauthAccessToken(db, first.tokens.access_token),
		).not.toBeNull();
		const again = await exchange(c.clientId, c.code);
		expect(!again.ok && again.error.error_description).toBe(
			"This code was already used.",
		);
		expect(
			await resolveOauthAccessToken(db, first.tokens.access_token),
		).toBeNull();
		const refreshed = await refreshOauthTokens(db, {
			refreshToken: first.tokens.refresh_token,
			clientId: c.clientId,
		});
		expect(refreshed.ok).toBe(false);
	});

	test("two concurrent uses of one code: one wins, then its grant is revoked", async () => {
		const c = await approvedCode();
		const [a, b] = await Promise.all([
			exchange(c.clientId, c.code),
			exchange(c.clientId, c.code),
		]);
		expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
		const winner = (a.ok ? a : b) as Extract<typeof a, { ok: true }>;
		expect(
			await resolveOauthAccessToken(db, winner.tokens.access_token),
		).toBeNull();
	});

	test("an expired code is refused", async () => {
		const c = await approvedCode();
		await db
			.updateTable("oauth_codes")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("code_hash", "=", hashOauthSecret(c.code))
			.execute();
		const r = await exchange(c.clientId, c.code);
		expect(!r.ok && r.error.error_description).toBe("Unknown or expired code.");
	});

	test("an expired access token resolves to null", async () => {
		const { tokens } = await tokensFor();
		await db
			.updateTable("oauth_tokens")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("token_hash", "=", hashOauthSecret(tokens.access_token))
			.execute();
		expect(await resolveOauthAccessToken(db, tokens.access_token)).toBeNull();
	});

	test("refresh rotates; the old refresh token presented again revokes the grant", async () => {
		const { tokens, clientId } = await tokensFor();
		const next = await refreshOauthTokens(db, {
			refreshToken: tokens.refresh_token,
			clientId,
		});
		if (!next.ok) throw new Error("refresh failed");
		expect(next.tokens.refresh_token).not.toBe(tokens.refresh_token);
		expect(
			await resolveOauthAccessToken(db, next.tokens.access_token),
		).not.toBeNull();
		// The retired one again: the grant ends, including the fresh pair.
		const replay = await refreshOauthTokens(db, {
			refreshToken: tokens.refresh_token,
			clientId,
		});
		expect(replay.ok).toBe(false);
		expect(
			await resolveOauthAccessToken(db, next.tokens.access_token),
		).toBeNull();
		const after = await refreshOauthTokens(db, {
			refreshToken: next.tokens.refresh_token,
			clientId,
		});
		expect(after.ok).toBe(false);
	});

	test("two concurrent refreshes with one token: one rotates, then the grant is revoked", async () => {
		const { tokens, clientId } = await tokensFor();
		const [a, b] = await Promise.all([
			refreshOauthTokens(db, { refreshToken: tokens.refresh_token, clientId }),
			refreshOauthTokens(db, { refreshToken: tokens.refresh_token, clientId }),
		]);
		expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
		const winner = (a.ok ? a : b) as Extract<typeof a, { ok: true }>;
		expect(
			await resolveOauthAccessToken(db, winner.tokens.access_token),
		).toBeNull();
	});

	test("a refresh from another client is refused and does not rotate", async () => {
		const { tokens, clientId } = await tokensFor();
		const other = await makeClient();
		const r = await refreshOauthTokens(db, {
			refreshToken: tokens.refresh_token,
			clientId: other,
		});
		expect(r.ok).toBe(false);
		expect(
			(
				await refreshOauthTokens(db, {
					refreshToken: tokens.refresh_token,
					clientId,
				})
			).ok,
		).toBe(true);
	});

	test("an expired refresh token is refused", async () => {
		const { tokens, clientId } = await tokensFor();
		await db
			.updateTable("oauth_tokens")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("token_hash", "=", hashOauthSecret(tokens.refresh_token))
			.execute();
		const r = await refreshOauthTokens(db, {
			refreshToken: tokens.refresh_token,
			clientId,
		});
		expect(r.ok).toBe(false);
	});

	test("revoking deletes the tokens at once; only the owner can revoke", async () => {
		const { tokens, accountId, clientId } = await tokensFor();
		const grants = await listOauthGrants(db, accountId);
		expect(grants).toHaveLength(1);
		expect(grants[0].clientName).toBe("Claude Code");
		const grantId = grants[0].id;
		expect(await revokeOauthGrant(db, grantId, await makeAccount())).toBe(
			false,
		);
		expect(
			await resolveOauthAccessToken(db, tokens.access_token),
		).not.toBeNull();
		expect(await revokeOauthGrant(db, grantId, accountId)).toBe(true);
		expect(await resolveOauthAccessToken(db, tokens.access_token)).toBeNull();
		expect(
			(
				await refreshOauthTokens(db, {
					refreshToken: tokens.refresh_token,
					clientId,
				})
			).ok,
		).toBe(false);
		expect(await listOauthGrants(db, accountId)).toEqual([]);
		expect(await revokeOauthGrant(db, grantId, accountId)).toBe(false);
	});

	test("purge drops expired rows, dead grants and never-used clients", async () => {
		const { tokens, accountId } = await tokensFor();
		const unused = await makeClient();
		const live = (await listOauthGrants(db, accountId))[0].id;
		await db
			.updateTable("oauth_clients")
			.set({ created_at: new Date(Date.now() - OAUTH_TTL.unusedClientMs - 1) })
			.where("id", "=", unused)
			.execute();
		await purgeOauth(db);
		expect(
			await db
				.selectFrom("oauth_clients")
				.select("id")
				.where("id", "=", unused)
				.executeTakeFirst(),
		).toBeUndefined();
		// A live grant and its tokens survive.
		expect(
			await resolveOauthAccessToken(db, tokens.access_token),
		).not.toBeNull();

		// Once every token has run out, the grant goes too.
		await db
			.updateTable("oauth_tokens")
			.set({ expires_at: new Date(Date.now() - 1000) })
			.where("grant_id", "=", live)
			.execute();
		await db
			.updateTable("oauth_grants")
			.set({ created_at: sql<Date>`now() - interval '1 day'` })
			.where("id", "=", live)
			.execute();
		expect(await purgeOauth(db)).toBeGreaterThanOrEqual(3);
		expect(
			await db
				.selectFrom("oauth_grants")
				.select("id")
				.where("id", "=", live)
				.executeTakeFirst(),
		).toBeUndefined();
	});
});
