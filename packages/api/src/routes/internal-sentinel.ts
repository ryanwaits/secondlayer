/**
 * `/internal/sentinel/*`: the identity contract between Sentinel's worker (a
 * product on this platform, with its own sign-in, console and Stripe billing)
 * and the shared secondlayer account underneath it. Server-to-server only.
 * Money is not here: Sentinel bills on its own Stripe subscriptions.
 *
 *   POST /accounts/resolve   { email }                                  find-or-create (+ linked)
 *   POST /accounts/link      { accountId }                              owner opted in (via consent)
 *   POST /tokens/resolve     { tokenHash }                              SHA-256 hex of a presented ss-sl_/sk-snt_ token (session: + email, linked)
 *   POST /keys               { accountId, name, areas }                 mint a sentinel agent key (raw key shown once)
 *   GET  /keys?accountId=                                               list the account's active sentinel keys
 *   DELETE /keys/:id?accountId=                                         revoke one of that account's sentinel keys
 *
 * Guard: `SENTINEL_SERVICE_KEY` ONLY (constant-time, unset key authenticates
 * nobody). `WORKLOAD_HOST_KEY` does not open these routes. `/internal/meters`
 * no longer takes this key: every `sentinel.*` unit is retired.
 * Every route past resolve/link also requires the account to be in
 * `sentinel_accounts` (created by Sentinel, or linked with consent), else 403
 * `account_not_linked`: a leaked key can't touch an arbitrary account.
 */

import { timingSafeEqual } from "node:crypto";
import {
	findOrCreateAccountByEmail,
	getAccountById,
	isSentinelLinked,
	linkSentinelAccount,
} from "@secondlayer/platform/db/queries/accounts";
import { getDb } from "@secondlayer/shared/db";
import {
	AuthenticationError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { assertUnderKeyCeiling, mintApiKey } from "../auth/mint.ts";
import { lookupSession } from "../auth/session.ts";
import { InvalidJSONError } from "../middleware/error.ts";
import { bearerToken } from "./internal-meters.ts";

/** Constant-time compare against `SENTINEL_SERVICE_KEY`. An unset key
 *  authenticates nobody. It also never matches when the configured value
 *  equals `WORKLOAD_HOST_KEY`, so the workload host key can't stand in for the
 *  Sentinel key on `/internal/sentinel/*`. */
export function sentinelServiceKeyMatches(
	provided: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const expected = env.SENTINEL_SERVICE_KEY?.trim();
	if (!expected || provided.length === 0) return false;
	if (expected === env.WORKLOAD_HOST_KEY?.trim()) return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

async function readBody(req: {
	json: () => Promise<unknown>;
}): Promise<Record<string, unknown>> {
	const body = await req.json().catch(() => {
		throw new InvalidJSONError();
	});
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new ValidationError("body must be a JSON object");
	}
	return body as Record<string, unknown>;
}

function requireString(
	body: Record<string, unknown>,
	field: string,
	max = 256,
): string {
	const v = body[field];
	if (typeof v !== "string" || v.trim().length === 0 || v.length > max) {
		throw new ValidationError(`${field} is required`);
	}
	return v;
}

const AREA_NAMES = ["plans", "monitoring", "alerts"] as const;
const AREA_LEVELS = ["none", "read", "write"] as const;
type AreaLevel = (typeof AREA_LEVELS)[number];
export type SentinelAreas = Record<(typeof AREA_NAMES)[number], AreaLevel>;

/** Exactly the three known areas, each none|read|write. Anything else is rejected. */
export function parseAreas(raw: unknown): SentinelAreas {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new ValidationError("areas must be an object");
	}
	const input = raw as Record<string, unknown>;
	for (const k of Object.keys(input)) {
		if (!(AREA_NAMES as readonly string[]).includes(k)) {
			throw new ValidationError(`unknown area "${k}"`);
		}
	}
	const out = {} as SentinelAreas;
	for (const name of AREA_NAMES) {
		const level = input[name];
		if (!(AREA_LEVELS as readonly unknown[]).includes(level)) {
			throw new ValidationError(
				`areas.${name} must be one of ${AREA_LEVELS.join(", ")}`,
			);
		}
		out[name] = level as AreaLevel;
	}
	return out;
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Existing account that Sentinel may touch, else 404 / 403 account_not_linked. */
async function requireLinkedAccount(accountId: string) {
	const account = await requireAccount(accountId);
	if (!(await isSentinelLinked(getDb(), accountId))) {
		throw new ForbiddenError("account_not_linked");
	}
	return account;
}

async function requireAccount(accountId: string) {
	const account = UUID_RE.test(accountId)
		? await getAccountById(getDb(), accountId)
		: null;
	if (!account) throw new NotFoundError("Account not found");
	return account;
}

export function createInternalSentinelRouter() {
	const app = new Hono();

	app.use("*", async (c, next) => {
		const key = bearerToken(c.req.header("authorization"));
		if (!key || !sentinelServiceKeyMatches(key)) {
			throw new AuthenticationError("Missing or invalid Authorization header", {
				hint: "Send the Sentinel service key as `Authorization: Bearer $SENTINEL_SERVICE_KEY`.",
				env_var: "SENTINEL_SERVICE_KEY",
			});
		}
		await next();
	});

	app.post("/accounts/resolve", async (c) => {
		const body = await readBody(c.req);
		const email = requireString(body, "email", 320);
		if (!email.includes("@")) throw new ValidationError("email is invalid");
		const db = getDb();
		const { account, created, linked } = await db
			.transaction()
			.execute(async (trx) => {
				const found = await findOrCreateAccountByEmail(trx, email);
				// Only an account Sentinel itself created is linked here; an
				// existing account waits for /accounts/link (owner consent).
				if (found.created) {
					await linkSentinelAccount(trx, found.account.id, "created");
					return { ...found, linked: true };
				}
				return {
					...found,
					linked: await isSentinelLinked(trx, found.account.id),
				};
			});
		return c.json({
			accountId: account.id,
			created,
			hadAccount: !created,
			linked,
		});
	});

	app.post("/accounts/link", async (c) => {
		const body = await readBody(c.req);
		const accountId = requireString(body, "accountId");
		await requireAccount(accountId);
		await linkSentinelAccount(getDb(), accountId, "consent");
		return c.json({ linked: true });
	});

	// Resolve a presented token (by hash, never the raw token) to the account it
	// belongs to. Sessions honor expiry/revocation exactly like requireAuth; keys
	// must be active and `sentinel`-product. An active key of another product
	// (an account key) is a 404 `other_product`, so Sentinel can say which key
	// to use; it never resolves. Anything else is a flat 404.
	app.post("/tokens/resolve", async (c) => {
		const body = await readBody(c.req);
		const tokenHash = requireString(body, "tokenHash", 64);
		if (!SHA256_HEX_RE.test(tokenHash)) {
			throw new ValidationError(
				"tokenHash must be a lowercase SHA-256 hex digest",
			);
		}
		const db = getDb();
		const lookup = await lookupSession(db, tokenHash);
		if (lookup.status === "ok") {
			// A session is a person who signed in with this email, so Sentinel
			// can create its user from it. `linked` says whether it may spend.
			const accountId = lookup.session.account_id;
			const [account, linked] = await Promise.all([
				getAccountById(db, accountId),
				isSentinelLinked(db, accountId),
			]);
			const email = account?.email?.trim().toLowerCase();
			return c.json({
				accountId,
				kind: "session",
				...(email ? { email } : {}),
				linked,
			});
		}
		const key = await db
			.selectFrom("api_keys")
			.select(["id", "account_id", "areas", "product"])
			.where("key_hash", "=", tokenHash)
			.where("status", "=", "active")
			.executeTakeFirst();
		if (!key) throw new NotFoundError("Token not found");
		if (key.product !== "sentinel") {
			return c.json({ error: "other_product" }, 404);
		}
		return c.json({
			accountId: key.account_id,
			kind: "key",
			keyId: key.id,
			areas: key.areas,
		});
	});

	app.post("/keys", async (c) => {
		const body = await readBody(c.req);
		const accountId = requireString(body, "accountId");
		const name = requireString(body, "name", 64);
		const areas = parseAreas(body.areas);
		await requireLinkedAccount(accountId);
		const db = getDb();
		await assertUnderKeyCeiling(db, accountId);
		const minted = await mintApiKey(db, {
			accountId,
			name,
			product: "sentinel",
			areas,
			ip: "sentinel",
		});
		return c.json(
			{
				id: minted.id,
				key: minted.key,
				prefix: minted.prefix,
				name,
				areas,
				createdAt: minted.createdAt,
			},
			201,
		);
	});

	app.get("/keys", async (c) => {
		const accountId = c.req.query("accountId") ?? "";
		if (!accountId) throw new ValidationError("accountId is required");
		await requireLinkedAccount(accountId);
		const rows = await getDb()
			.selectFrom("api_keys")
			.select([
				"id",
				"name",
				"key_prefix",
				"areas",
				"created_at",
				"last_used_at",
			])
			.where("account_id", "=", accountId)
			.where("product", "=", "sentinel")
			.where("status", "=", "active")
			.orderBy("created_at", "desc")
			.execute();
		return c.json({
			keys: rows.map((r) => ({
				id: r.id,
				name: r.name,
				prefix: r.key_prefix,
				areas: r.areas,
				createdAt: r.created_at.toISOString(),
				lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
			})),
		});
	});

	app.delete("/keys/:id", async (c) => {
		const accountId = c.req.query("accountId") ?? "";
		if (!accountId) throw new ValidationError("accountId is required");
		const id = c.req.param("id");
		await requireLinkedAccount(accountId);
		const revoked = UUID_RE.test(id)
			? await getDb()
					.updateTable("api_keys")
					.set({ status: "revoked", revoked_at: new Date() })
					.where("id", "=", id)
					.where("account_id", "=", accountId)
					.where("product", "=", "sentinel")
					.where("status", "=", "active")
					.returning("id")
					.executeTakeFirst()
			: undefined;
		if (!revoked) throw new NotFoundError("Key not found");
		return c.json({ revoked: true });
	});

	return app;
}

export default createInternalSentinelRouter();
