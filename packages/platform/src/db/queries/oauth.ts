import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Database } from "@secondlayer/shared/db";
import { type Kysely, type Transaction, sql } from "kysely";

/**
 * OAuth for the hosted MCP endpoint: the stored side. The HTTP side (metadata,
 * registration, authorize, token) lives in `packages/api/src/auth/oauth/`.
 *
 *   - Codes and tokens are random, shown once, and stored as SHA-256 only.
 *   - A code works once (an atomic claim) and is bound to the client, the
 *     redirect, the PKCE challenge, the resource and the account. A code
 *     presented again revokes the grant its first use made.
 *   - Access tokens live 1 h. Refresh tokens live 30 days and rotate on every
 *     use; a retired one presented again revokes the whole grant.
 *   - Revoking a grant deletes its tokens at once.
 *
 * Every lifetime is here, in `OAUTH_TTL`, and nowhere else.
 */

export const OAUTH_ACCESS_PREFIX = "oat-sl_";
export const OAUTH_REFRESH_PREFIX = "ort-sl_";
/** The one scope: use the hosted MCP as the account. */
export const OAUTH_SCOPE = "mcp";

export const OAUTH_TTL = {
	accessSeconds: 60 * 60,
	refreshMs: 30 * 24 * 60 * 60 * 1000,
	/** The consent window for an authorize request. */
	requestMs: 10 * 60 * 1000,
	codeMs: 10 * 60 * 1000,
	/** A registered client that never got a token is dropped after this. */
	unusedClientMs: 24 * 60 * 60 * 1000,
} as const;

/** `grants.last_used_at` is written at most this often per grant. */
const LAST_USED_GRANULARITY = "1 minute";

type Db = Kysely<Database>;

const random = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function hashOauthSecret(raw: string): string {
	return createHash("sha256").update(raw).digest("hex");
}

/** PKCE S256 (RFC 7636 §4.6): BASE64URL(SHA256(verifier)) equals the challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
	const computed = Buffer.from(
		createHash("sha256").update(verifier).digest("base64url"),
	);
	const expected = Buffer.from(challenge);
	return (
		computed.length === expected.length && timingSafeEqual(computed, expected)
	);
}

export type OauthTokens = {
	access_token: string;
	token_type: "Bearer";
	expires_in: number;
	refresh_token: string;
	scope: string;
};

/** An RFC 6749 §5.2 error, for the token endpoint to send as-is. */
export type OauthTokenError = {
	error: "invalid_grant" | "invalid_target";
	error_description: string;
};

export type OauthTokenResult =
	| { ok: true; tokens: OauthTokens }
	| { ok: false; error: OauthTokenError };

const grantError = (description: string): OauthTokenResult => ({
	ok: false,
	error: { error: "invalid_grant", error_description: description },
});

// ── clients ─────────────────────────────────────────────────────────────

export async function registerOauthClient(
	db: Db,
	input: { name: string; redirectUris: string[]; ip: string | null },
): Promise<{ id: string; createdAt: Date }> {
	const row = await db
		.insertInto("oauth_clients")
		.values({
			id: `ocl_${random(18)}`,
			name: input.name,
			redirect_uris: input.redirectUris,
			created_ip: input.ip,
		})
		.returning(["id", "created_at"])
		.executeTakeFirstOrThrow();
	return { id: row.id, createdAt: row.created_at };
}

export async function getOauthClient(
	db: Db,
	clientId: string,
): Promise<{ id: string; name: string; redirectUris: string[] } | null> {
	if (!clientId) return null;
	const row = await db
		.selectFrom("oauth_clients")
		.select(["id", "name", "redirect_uris"])
		.where("id", "=", clientId)
		.executeTakeFirst();
	return row
		? { id: row.id, name: row.name, redirectUris: row.redirect_uris }
		: null;
}

// ── authorize requests (answered on the consent page) ───────────────────

export async function createOauthRequest(
	db: Db,
	input: {
		clientId: string;
		redirectUri: string;
		state: string | null;
		codeChallenge: string;
		resource: string;
	},
): Promise<string> {
	const id = `oar_${random(18)}`;
	await db
		.insertInto("oauth_requests")
		.values({
			id,
			client_id: input.clientId,
			redirect_uri: input.redirectUri,
			state: input.state,
			code_challenge: input.codeChallenge,
			resource: input.resource,
			expires_at: new Date(Date.now() + OAUTH_TTL.requestMs),
		})
		.execute();
	return id;
}

export type OauthRequestView = {
	id: string;
	clientName: string;
	redirectUri: string;
	expiresAt: Date;
};

/** A request still waiting for an answer, with its client's name; else null. */
export async function getOpenOauthRequest(
	db: Db,
	requestId: string,
): Promise<OauthRequestView | null> {
	const row = await db
		.selectFrom("oauth_requests as r")
		.innerJoin("oauth_clients as c", "c.id", "r.client_id")
		.select(["r.id", "r.redirect_uri", "r.expires_at", "c.name"])
		.where("r.id", "=", requestId)
		.where("r.status", "=", "pending")
		.where("r.expires_at", ">", sql<Date>`now()`)
		.executeTakeFirst();
	return row
		? {
				id: row.id,
				clientName: row.name,
				redirectUri: row.redirect_uri,
				expiresAt: row.expires_at,
			}
		: null;
}

/** Answer a pending request; `then` runs in the same transaction. */
async function answerRequest<T>(
	db: Db,
	requestId: string,
	accountId: string,
	status: "approved" | "denied",
	then: (
		trx: Transaction<Database>,
		row: {
			client_id: string;
			redirect_uri: string;
			state: string | null;
			code_challenge: string;
			resource: string;
		},
	) => Promise<T>,
): Promise<T | null> {
	return db.transaction().execute(async (trx) => {
		const row = await trx
			.updateTable("oauth_requests")
			.set({ status, account_id: accountId, answered_at: new Date() })
			.where("id", "=", requestId)
			.where("status", "=", "pending")
			.where("expires_at", ">", sql<Date>`now()`)
			.returning([
				"client_id",
				"redirect_uri",
				"state",
				"code_challenge",
				"resource",
			])
			.executeTakeFirst();
		return row ? then(trx, row) : null;
	});
}

/** The person allowed it: mint the one-time code. Null if not pending. */
export async function approveOauthRequest(
	db: Db,
	requestId: string,
	accountId: string,
): Promise<{ code: string; redirectUri: string; state: string | null } | null> {
	return answerRequest(
		db,
		requestId,
		accountId,
		"approved",
		async (trx, row) => {
			const code = random();
			await trx
				.insertInto("oauth_codes")
				.values({
					code_hash: hashOauthSecret(code),
					client_id: row.client_id,
					account_id: accountId,
					redirect_uri: row.redirect_uri,
					code_challenge: row.code_challenge,
					resource: row.resource,
					expires_at: new Date(Date.now() + OAUTH_TTL.codeMs),
				})
				.execute();
			return { code, redirectUri: row.redirect_uri, state: row.state };
		},
	);
}

/** The person said no. Null if not pending. */
export async function denyOauthRequest(
	db: Db,
	requestId: string,
	accountId: string,
): Promise<{ redirectUri: string; state: string | null } | null> {
	return answerRequest(
		db,
		requestId,
		accountId,
		"denied",
		async (_trx, row) => ({ redirectUri: row.redirect_uri, state: row.state }),
	);
}

// ── tokens ──────────────────────────────────────────────────────────────

async function issueTokens(
	trx: Transaction<Database>,
	grantId: string,
	clientId: string,
): Promise<OauthTokens> {
	const access = `${OAUTH_ACCESS_PREFIX}${random()}`;
	const refresh = `${OAUTH_REFRESH_PREFIX}${random()}`;
	const now = Date.now();
	await trx
		.insertInto("oauth_tokens")
		.values([
			{
				token_hash: hashOauthSecret(access),
				grant_id: grantId,
				kind: "access",
				expires_at: new Date(now + OAUTH_TTL.accessSeconds * 1000),
			},
			{
				token_hash: hashOauthSecret(refresh),
				grant_id: grantId,
				kind: "refresh",
				expires_at: new Date(now + OAUTH_TTL.refreshMs),
			},
		])
		.execute();
	await trx
		.updateTable("oauth_grants")
		.set({ last_used_at: new Date() })
		.where("id", "=", grantId)
		.execute();
	await trx
		.updateTable("oauth_clients")
		.set({ last_used_at: new Date() })
		.where("id", "=", clientId)
		.execute();
	return {
		access_token: access,
		token_type: "Bearer",
		expires_in: OAUTH_TTL.accessSeconds,
		refresh_token: refresh,
		scope: OAUTH_SCOPE,
	};
}

/** Revoke a grant and delete every token it issued. True when it was live.
 *  With `accountId`, only that account's grant. */
export async function revokeOauthGrant(
	db: Db | Transaction<Database>,
	grantId: string,
	accountId?: string,
): Promise<boolean> {
	let q = db
		.updateTable("oauth_grants")
		.set({ revoked_at: new Date() })
		.where("id", "=", grantId)
		.where("revoked_at", "is", null);
	if (accountId !== undefined) q = q.where("account_id", "=", accountId);
	const res = await q.executeTakeFirst();
	const revoked = Number(res.numUpdatedRows) > 0;
	if (revoked) {
		await db
			.deleteFrom("oauth_tokens")
			.where("grant_id", "=", grantId)
			.execute();
	}
	return revoked;
}

/**
 * Swap a code for tokens. The caller has checked the client exists; every
 * binding is checked here. A code seen used is a replay: its grant is revoked.
 */
export async function exchangeOauthCode(
	db: Db,
	input: {
		code: string;
		clientId: string;
		redirectUri: string;
		codeVerifier: string;
		resource: string | null;
	},
): Promise<OauthTokenResult> {
	if (!input.code) return grantError("Unknown or expired code.");
	const hash = hashOauthSecret(input.code);
	const row = await db
		.selectFrom("oauth_codes")
		.selectAll()
		.select(sql<boolean>`expires_at <= now()`.as("expired"))
		.where("code_hash", "=", hash)
		.executeTakeFirst();
	if (!row) return grantError("Unknown or expired code.");
	if (row.used_at) {
		// A code used twice: someone else has it. End what its first use made.
		if (row.grant_id) await revokeOauthGrant(db, row.grant_id);
		return grantError("This code was already used.");
	}
	if (row.expired) return grantError("Unknown or expired code.");
	if (row.client_id !== input.clientId)
		return grantError("The code is for another client.");
	if (row.redirect_uri !== input.redirectUri)
		return grantError("redirect_uri does not match the authorization request.");
	if (input.resource !== null && input.resource !== row.resource)
		return {
			ok: false,
			error: {
				error: "invalid_target",
				error_description: `resource must be ${row.resource}.`,
			},
		};
	if (!pkceMatches(input.codeVerifier, row.code_challenge))
		return grantError("code_verifier does not match the code_challenge.");

	const tokens = await db.transaction().execute(async (trx) => {
		const claimed = await trx
			.updateTable("oauth_codes")
			.set({ used_at: new Date() })
			.where("code_hash", "=", hash)
			.where("used_at", "is", null)
			.returning("code_hash")
			.executeTakeFirst();
		if (!claimed) return null;
		const grant = await trx
			.insertInto("oauth_grants")
			.values({
				account_id: row.account_id,
				client_id: row.client_id,
				scope: OAUTH_SCOPE,
				resource: row.resource,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		await trx
			.updateTable("oauth_codes")
			.set({ grant_id: grant.id })
			.where("code_hash", "=", hash)
			.execute();
		return issueTokens(trx, grant.id, row.client_id);
	});
	if (tokens) return { ok: true, tokens };
	// Lost the claim to a concurrent use of the same code: that is a replay too.
	const winner = await db
		.selectFrom("oauth_codes")
		.select("grant_id")
		.where("code_hash", "=", hash)
		.executeTakeFirst();
	if (winner?.grant_id) await revokeOauthGrant(db, winner.grant_id);
	return grantError("This code was already used.");
}

/**
 * Rotate a refresh token: the old one is retired and a fresh pair issued. A
 * retired token presented again (it leaked, or two clients share it) revokes
 * the grant.
 */
export async function refreshOauthTokens(
	db: Db,
	input: { refreshToken: string; clientId: string },
): Promise<OauthTokenResult> {
	const invalid = "Unknown, expired or reused refresh token.";
	if (!input.refreshToken.startsWith(OAUTH_REFRESH_PREFIX))
		return grantError(invalid);
	const hash = hashOauthSecret(input.refreshToken);
	const result = await db.transaction().execute(async (trx) => {
		// Row lock: a concurrent use of the same token waits here, then finds
		// it retired below and revokes the grant.
		const live = await trx
			.selectFrom("oauth_tokens as t")
			.innerJoin("oauth_grants as g", "g.id", "t.grant_id")
			.select([
				"t.grant_id",
				"g.client_id",
				"g.revoked_at",
				sql<boolean>`t.expires_at <= now()`.as("expired"),
			])
			.where("t.token_hash", "=", hash)
			.where("t.kind", "=", "refresh")
			.forUpdate("t")
			.executeTakeFirst();
		if (!live) return { retired: true as const };
		if (live.revoked_at || live.expired) return grantError(invalid);
		if (live.client_id !== input.clientId)
			return grantError("The token is for another client.");
		await trx
			.deleteFrom("oauth_tokens")
			.where("token_hash", "=", hash)
			.execute();
		await trx
			.insertInto("oauth_refresh_retired")
			.values({ token_hash: hash, grant_id: live.grant_id })
			.onConflict((oc) => oc.column("token_hash").doNothing())
			.execute();
		const tokens = await issueTokens(trx, live.grant_id, live.client_id);
		return { ok: true as const, tokens };
	});
	if (!("retired" in result)) return result;
	const old = await db
		.selectFrom("oauth_refresh_retired")
		.select("grant_id")
		.where("token_hash", "=", hash)
		.executeTakeFirst();
	if (old) await revokeOauthGrant(db, old.grant_id);
	return grantError(invalid);
}

/** A live access token's grant and account; null when unknown, expired or
 *  revoked. Callers decide where the token may be used at all. */
export async function resolveOauthAccessToken(
	db: Db,
	raw: string,
): Promise<{ grantId: string; accountId: string } | null> {
	if (!raw.startsWith(OAUTH_ACCESS_PREFIX)) return null;
	const row = await db
		.selectFrom("oauth_tokens as t")
		.innerJoin("oauth_grants as g", "g.id", "t.grant_id")
		.select(["g.id", "g.account_id"])
		.where("t.token_hash", "=", hashOauthSecret(raw))
		.where("t.kind", "=", "access")
		.where("t.expires_at", ">", sql<Date>`now()`)
		.where("g.revoked_at", "is", null)
		.executeTakeFirst();
	if (!row) return null;
	await db
		.updateTable("oauth_grants")
		.set({ last_used_at: new Date() })
		.where("id", "=", row.id)
		.where((eb) =>
			eb.or([
				eb("last_used_at", "is", null),
				eb(
					"last_used_at",
					"<",
					sql<Date>`now() - ${LAST_USED_GRANULARITY}::interval`,
				),
			]),
		)
		.execute()
		.catch(() => {});
	return { grantId: row.id, accountId: row.account_id };
}

// ── connected apps (the keys page) ──────────────────────────────────────

export type OauthGrantSummary = {
	id: string;
	clientName: string;
	createdAt: Date;
	lastUsedAt: Date | null;
};

/** An account's live grants: not revoked, with a refresh token still valid. */
export async function listOauthGrants(
	db: Db,
	accountId: string,
): Promise<OauthGrantSummary[]> {
	const rows = await db
		.selectFrom("oauth_grants as g")
		.innerJoin("oauth_clients as c", "c.id", "g.client_id")
		.select(["g.id", "c.name", "g.created_at", "g.last_used_at"])
		.where("g.account_id", "=", accountId)
		.where("g.revoked_at", "is", null)
		.where(({ exists, selectFrom }) =>
			exists(
				selectFrom("oauth_tokens as t")
					.select(sql`1`.as("one"))
					.whereRef("t.grant_id", "=", "g.id")
					.where("t.kind", "=", "refresh")
					.where("t.expires_at", ">", sql<Date>`now()`),
			),
		)
		.orderBy("g.created_at", "desc")
		.execute();
	return rows.map((r) => ({
		id: r.id,
		clientName: r.name,
		createdAt: r.created_at,
		lastUsedAt: r.last_used_at,
	}));
}

// ── purge (hourly, worker) ──────────────────────────────────────────────

/**
 * Drop expired requests, codes and tokens, retired refresh tokens past a
 * refresh lifetime, grants with no token left (revoked or run out), clients
 * never used within a day, and clients with no grant left a refresh lifetime
 * after their last use. Returns the rows deleted.
 */
export async function purgeOauth(db: Db, now = new Date()): Promise<number> {
	const month = new Date(now.getTime() - OAUTH_TTL.refreshMs);
	const day = new Date(now.getTime() - OAUTH_TTL.unusedClientMs);
	let n = 0;
	const count = (r: { numDeletedRows: bigint }) => {
		n += Number(r.numDeletedRows);
	};
	count(
		await db
			.deleteFrom("oauth_requests")
			.where("expires_at", "<=", now)
			.executeTakeFirst(),
	);
	count(
		await db
			.deleteFrom("oauth_codes")
			.where("expires_at", "<=", now)
			.executeTakeFirst(),
	);
	count(
		await db
			.deleteFrom("oauth_tokens")
			.where("expires_at", "<=", now)
			.executeTakeFirst(),
	);
	count(
		await db
			.deleteFrom("oauth_refresh_retired")
			.where("retired_at", "<=", month)
			.executeTakeFirst(),
	);
	count(
		await db
			.deleteFrom("oauth_grants as g")
			.where("g.created_at", "<=", new Date(now.getTime() - 60_000))
			.where(({ not, exists, selectFrom }) =>
				not(
					exists(
						selectFrom("oauth_tokens as t")
							.select(sql`1`.as("one"))
							.whereRef("t.grant_id", "=", "g.id"),
					),
				),
			)
			.executeTakeFirst(),
	);
	count(
		await db
			.deleteFrom("oauth_clients as c")
			.where((eb) =>
				eb.or([
					eb.and([
						eb("c.last_used_at", "is", null),
						eb("c.created_at", "<=", day),
					]),
					eb.and([
						eb("c.last_used_at", "<=", month),
						eb.not(
							eb.exists(
								eb
									.selectFrom("oauth_grants as g")
									.select(sql`1`.as("one"))
									.whereRef("g.client_id", "=", "c.id"),
							),
						),
					]),
				]),
			)
			.executeTakeFirst(),
	);
	return n;
}
