import { RateLimitError, ValidationError } from "@secondlayer/shared/errors";
import { isPlatformMode } from "@secondlayer/shared/mode";
import type { BitcoinRpcConfig } from "@secondlayer/stacks/bitcoin";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { getClientIp } from "../auth/http.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import {
	OutspendBusyError,
	OutspendNotFoundError,
	type OutspendOptions,
	createOutspendLookup,
} from "../bitcoin/outspend.ts";
import {
	BitcoindRpcError,
	RPC_METHOD_NOT_FOUND,
	bitcoinRpcFromEnv,
	bitcoindCall,
} from "../bitcoin/rpc.ts";
import { MUTABLE_CACHE_CONTROL } from "../http/cache.ts";
import {
	DEFAULT_INDEX_TOKEN_STORE,
	type IndexEnv,
	type IndexTokenStore,
	indexBearerAuth,
} from "../index/auth.ts";
import { debitCreditedRead, indexCreditsGate } from "../index/credits-gate.ts";
import { validateQueryParams } from "../middleware/validation.ts";

/**
 * `/v1/bitcoin/*`: reads answered live from the instance's own Bitcoin node
 * (`BITCOIN_RPC_URL`; unset → 503). Keyed and metered like Index on hosted:
 * one row per answer.
 */

/** Hosted only, per account (or client IP). Internal keys are exempt. The
 *  bitcoind work behind it is bounded separately (`../bitcoin/outspend.ts`). */
export const OUTSPEND_RATE_LIMIT = { limit: 20, windowMs: 1_000 } as const;

/** An outpoint's index is a u32 on the wire. */
const MAX_VOUT = 0xffff_ffff;

export type BitcoinRouterOptions = {
	tokens?: IndexTokenStore;
	/** Read per request so the operator's env is authoritative at call time. */
	bitcoinRpc?: () => BitcoinRpcConfig | undefined;
	outspend?: OutspendOptions;
};

function outspendRateLimit(): MiddlewareHandler<IndexEnv> {
	return async (c, next) => {
		// Self-host is single-tenant: the operator's own box.
		if (!isPlatformMode()) return next();
		const tenant = c.get("indexTenant");
		if (tenant?.tier === "internal") return next();
		const { limit, windowMs } = OUTSPEND_RATE_LIMIT;
		const key = tenant
			? `bitcoin:outspend:${tenant.tenant_id}`
			: `bitcoin:outspend:anon:${getClientIp(c)}`;
		const result = await getRateLimitStore().check(key, limit, windowMs);
		c.header("X-RateLimit-Limit", String(limit));
		c.header(
			"X-RateLimit-Remaining",
			String(Math.max(0, limit - result.count)),
		);
		c.header("X-RateLimit-Reset", String(result.resetAt));
		if (!result.allowed) {
			c.header("Retry-After", String(result.retryAfter));
			throw new RateLimitError("Rate limit exceeded");
		}
		return next();
	};
}

function txidParam(value: string): string {
	const bare = value.startsWith("0x") ? value.slice(2) : value;
	if (!/^[0-9a-fA-F]{64}$/.test(bare)) {
		throw new ValidationError(
			"txid must be 64 hex characters (optional 0x prefix)",
		);
	}
	return bare.toLowerCase();
}

function voutParam(value: string): number {
	if (!/^\d+$/.test(value) || Number(value) > MAX_VOUT) {
		throw new ValidationError("vout must be a non-negative integer");
	}
	return Number(value);
}

function errorResponse(
	c: Context,
	status: 404 | 502 | 503,
	code: string,
	message: string,
	headers: Record<string, string> = {},
): Response {
	return c.json({ error: message, code }, status, headers);
}

export function createBitcoinRouter(opts: BitcoinRouterOptions = {}) {
	const bitcoinRpc = opts.bitcoinRpc ?? bitcoinRpcFromEnv;
	const lookup = createOutspendLookup(opts.outspend);

	const router = new Hono<IndexEnv>();
	router.use(
		"*",
		indexBearerAuth({ tokens: opts.tokens ?? DEFAULT_INDEX_TOKEN_STORE }),
	);
	router.use("*", indexCreditsGate());

	router.get("/outspend/:txid/:vout", outspendRateLimit(), async (c) => {
		validateQueryParams(new URL(c.req.url).searchParams, []);
		const txid = txidParam(c.req.param("txid"));
		const vout = voutParam(c.req.param("vout"));
		const config = bitcoinRpc();
		if (!config) {
			return errorResponse(
				c,
				503,
				"BITCOIN_UNAVAILABLE",
				"this instance has no Bitcoin node (BITCOIN_RPC_URL is not set)",
			);
		}

		let answer: Awaited<ReturnType<typeof lookup>>;
		try {
			answer = await lookup(bitcoindCall(config), txid, vout);
		} catch (err) {
			if (err instanceof OutspendNotFoundError) {
				return errorResponse(c, 404, "NOT_FOUND", err.message);
			}
			if (err instanceof OutspendBusyError) {
				return errorResponse(c, 503, "BITCOIN_BUSY", err.message, {
					"retry-after": "2",
				});
			}
			// Messages stay generic: transport errors can carry the RPC URL.
			const missing =
				err instanceof BitcoindRpcError && err.code === RPC_METHOD_NOT_FOUND;
			return errorResponse(
				c,
				502,
				"BITCOIN_SOURCE_ERROR",
				missing
					? `bitcoind has no ${err.method} method (Bitcoin Core 24 or later is required)`
					: "could not read from bitcoind",
			);
		}

		c.set("rowsServed", 1);
		if (isPlatformMode()) await debitCreditedRead(c, [answer]);
		return c.json(answer, 200, { "cache-control": MUTABLE_CACHE_CONTROL });
	});

	return router;
}

export default createBitcoinRouter();
