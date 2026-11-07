/**
 * A docs key for a signed-out reader.
 *
 *   POST /api/public/docs-key  { distinctId? }  →  201 { key, prefix, expiresAt }
 *
 * `distinctId` (optional) is the browser's PostHog id, for analytics only.
 *
 * Mounted only in platform mode. The browser calls it directly (never through
 * the web server) so the rate limit sees the reader's IP. Each mint creates a
 * ghost account (no email) that owns one `docs` key: read-only Streams and
 * Index, 24 hours, and at most `GHOST_ACCOUNT_ROWS_LIMIT` rows for the ghost's
 * whole life (`lib/read-credits.ts`). The worker deletes the ghost a week
 * after its key expires (`worker/src/jobs/ghost-accounts-purge.ts`).
 *
 * One mint per IP bucket (IPv4, or IPv6 /64) per rolling day and at most
 * `ANON_DOCS_KEY_GLOBAL_DAILY_LIMIT` across all readers, fail-closed: a store outage refuses rather
 * than mints. The plaintext key is in this response once and is never logged
 * or stored (only its hash is).
 */

import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import { RateLimitError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { getClientIp, ipBucket } from "../auth/http.ts";
import { mintDocsKey } from "../auth/mint.ts";
import {
	type RateLimitStore,
	getRateLimitStore,
} from "../auth/rate-limit-store.ts";
import {
	BrowserDistinctIdSchema,
	trackProductEvent,
	visitorSubject,
} from "../lib/product-events.ts";

/** Mints per IP bucket (IPv4, or IPv6 /64) per rolling day. */
export const ANON_DOCS_KEY_DAILY_LIMIT = 1;
/** Mints across every reader per rolling day: each is a ghost account with
 *  its own row budget, so a proxy pool cannot mint without bound. */
export const ANON_DOCS_KEY_GLOBAL_DAILY_LIMIT = 500;
const RATE_LIMITED_COPY = "One docs key a day without an account";
const DAY_MS = 24 * 60 * 60 * 1000;

export function createPublicDocsKeyRouter(opts?: {
	getDb?: typeof getDb;
	rateLimitStore?: RateLimitStore;
}) {
	const app = new Hono();
	const resolveDb = opts?.getDb ?? getDb;

	app.post("/", async (c) => {
		c.header("Cache-Control", "no-store");
		const ip = getClientIp(c);
		const store = opts?.rateLimitStore ?? getRateLimitStore();
		const refuse = (retryAfter: number): never => {
			c.header("Retry-After", String(retryAfter));
			throw new RateLimitError(RATE_LIMITED_COPY);
		};
		// Per reader first, so a refused reader never spends a global slot.
		const perReader = await store.check(
			`docs-key-anon:${ipBucket(ip)}`,
			ANON_DOCS_KEY_DAILY_LIMIT,
			DAY_MS,
			{ failClosed: true },
		);
		if (!perReader.allowed) refuse(perReader.retryAfter);
		const global = await store.check(
			"docs-key-anon:all",
			ANON_DOCS_KEY_GLOBAL_DAILY_LIMIT,
			DAY_MS,
			{ failClosed: true },
		);
		if (!global.allowed) {
			logger.warn("docs_key.anon_mint_ceiling", {
				ceiling: ANON_DOCS_KEY_GLOBAL_DAILY_LIMIT,
			});
			refuse(global.retryAfter);
		}

		const { ghostId, minted } = await resolveDb()
			.transaction()
			.execute(async (trx) => {
				const ghost = await trx
					.insertInto("accounts")
					.values({ email: null, ghost: true })
					.returning("id")
					.executeTakeFirstOrThrow();
				return {
					ghostId: ghost.id,
					minted: await mintDocsKey(trx, { accountId: ghost.id, ip }),
				};
			});
		logger.info("docs_key.anon_mint", {
			mintsToday: global.count,
			ceiling: ANON_DOCS_KEY_GLOBAL_DAILY_LIMIT,
		});
		// The page may send its PostHog id so the mint joins the reader's
		// pageviews; anything else in the body is ignored. Without it, the
		// ghost's id stands in, which the key's first read also uses.
		const body = (await c.req.json().catch(() => null)) as {
			distinctId?: unknown;
		} | null;
		trackProductEvent(
			visitorSubject(BrowserDistinctIdSchema.parse(body?.distinctId), ghostId),
			{ event: "docs_key_minted", properties: { signed_in: false } },
		);
		return c.json(
			{ key: minted.key, prefix: minted.prefix, expiresAt: minted.expiresAt },
			201,
		);
	});

	return app;
}

export default createPublicDocsKeyRouter();
