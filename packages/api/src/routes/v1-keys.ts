import { logger } from "@secondlayer/shared";
import { getDb as defaultGetDb } from "@secondlayer/shared/db";
import { RateLimitError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { createClaimToken } from "../auth/ghost.ts";
import { getClientIp } from "../auth/http.ts";
import { mintApiKey } from "../auth/mint.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";

/**
 * Anonymous self-serve key mint ("ghost keys"). `POST /v1/keys` with NO auth
 * creates a ghost account (ghost=true, email NULL) and a free-tier key,
 * returned exactly once, plus a claim URL. Posture:
 *  - Read-only: the key is product `account` (reads streams + index), but the
 *    requireAuth ghost guard 403s every non-GET until the account is claimed —
 *    no deploys, no subscriptions, no key minting.
 *  - No rate uplift: the tier is pinned `free` (10/s), below the anon per-IP
 *    limit (50/s), so a ghost key never out-runs unauthenticated access.
 *  - Abuse bounds: ~3 mints/IP/day + a global daily circuit breaker.
 * Browser POSTs are blocked by the GET-only public /v1 CORS — this is a
 * bearer-less, agent-facing surface (CORS is browser-enforced, which is fine).
 */

const PER_IP_DAILY_LIMIT = 3;
const GLOBAL_DAILY_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Read scopes the minted key grants — descriptive, mirrors the ghost guard. */
const GHOST_SCOPES = ["streams:read", "index:read"] as const;

function claimBaseUrl(): string {
	return process.env.PLATFORM_BASE_URL ?? "https://secondlayer.tools";
}

export function createV1KeysRouter(opts?: {
	getDb?: typeof defaultGetDb;
}): Hono {
	const getDb = opts?.getDb ?? defaultGetDb;
	const app = new Hono();

	app.post("/", async (c) => {
		const ip = getClientIp(c);
		const store = getRateLimitStore();

		// Global circuit breaker first: when tripped, stop consuming per-IP
		// budget too (a legit caller shouldn't burn their 3/day on a tripped day).
		const global = await store.check(
			"ghostkeys:global",
			GLOBAL_DAILY_LIMIT,
			DAY_MS,
			{ failClosed: true },
		);
		if (!global.allowed) {
			c.header("Retry-After", String(global.retryAfter));
			throw new RateLimitError(
				"Anonymous key minting is temporarily paused. Try again later or sign up at https://secondlayer.tools.",
			);
		}

		// Per-IP daily mint cap. `unknown` IPs (no proxy headers — direct local
		// hits) share one bucket; the global breaker still bounds them.
		const perIp = await store.check(
			`ghostkeys:ip:${ip}`,
			PER_IP_DAILY_LIMIT,
			DAY_MS,
			{ failClosed: true },
		);
		if (!perIp.allowed) {
			c.header("Retry-After", String(perIp.retryAfter));
			throw new RateLimitError(
				`Anonymous key mint limit reached (${PER_IP_DAILY_LIMIT}/day per IP). Claim an existing key to mint more.`,
			);
		}

		const db = getDb();
		const account = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();

		const minted = await mintApiKey(db, {
			accountId: account.id,
			name: "ghost",
			product: "account",
			tier: "free",
			ip,
		});

		const claim = await createClaimToken(db, account.id);

		// Abuse-response breadcrumb: who minted what from where.
		logger.info("Ghost key minted", {
			accountId: account.id,
			keyPrefix: minted.prefix,
			ip,
			userAgent: c.req.header("user-agent") ?? null,
		});

		return c.json(
			{
				key: minted.key,
				tier: "free",
				scopes: GHOST_SCOPES,
				claim_url: `${claimBaseUrl()}/claim/${claim.raw}`,
				claim_expires_at: claim.expiresAt.toISOString(),
			},
			201,
		);
	});

	return app;
}

export default createV1KeysRouter();
