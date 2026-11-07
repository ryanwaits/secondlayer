/**
 * A docs key for a signed-out reader.
 *
 *   POST /api/public/docs-key  {}  →  201 { key, prefix, expiresAt }
 *
 * Mounted only in platform mode. The browser calls it directly (never through
 * the web server) so the rate limit sees the reader's IP. Each mint creates a
 * ghost account (no email) that owns one `docs` key: read-only Streams and
 * Index, 24 hours, and at most `GHOST_ACCOUNT_ROWS_LIMIT` rows for the ghost's
 * whole life (`lib/read-credits.ts`). The worker deletes the ghost a week
 * after its key expires (`worker/src/jobs/ghost-accounts-purge.ts`).
 *
 * One mint per IP per rolling day, fail-closed: a store outage refuses rather
 * than mints. The plaintext key is in this response once and is never logged
 * or stored (only its hash is).
 */

import { getDb } from "@secondlayer/shared/db";
import { RateLimitError } from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { getClientIp } from "../auth/http.ts";
import { mintDocsKey } from "../auth/mint.ts";
import {
	type RateLimitStore,
	getRateLimitStore,
} from "../auth/rate-limit-store.ts";

export const ANON_DOCS_KEY_DAILY_LIMIT = 1;
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
		const limit = await (opts?.rateLimitStore ?? getRateLimitStore()).check(
			`docs-key-anon:${ip}`,
			ANON_DOCS_KEY_DAILY_LIMIT,
			DAY_MS,
			{ failClosed: true },
		);
		if (!limit.allowed) {
			c.header("Retry-After", String(limit.retryAfter));
			throw new RateLimitError("One docs key a day without an account");
		}

		const minted = await resolveDb()
			.transaction()
			.execute(async (trx) => {
				const ghost = await trx
					.insertInto("accounts")
					.values({ email: null, ghost: true })
					.returning("id")
					.executeTakeFirstOrThrow();
				return mintDocsKey(trx, { accountId: ghost.id, ip });
			});
		return c.json(
			{ key: minted.key, prefix: minted.prefix, expiresAt: minted.expiresAt },
			201,
		);
	});

	return app;
}

export default createPublicDocsKeyRouter();
