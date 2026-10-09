import { RateLimitError, ValidationError } from "@secondlayer/shared/errors";
import { isPlatformMode } from "@secondlayer/shared/mode";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import {
	IMMUTABLE_CACHE_CONTROL,
	MUTABLE_CACHE_CONTROL,
} from "../http/cache.ts";
import {
	DEFAULT_INDEX_TOKEN_STORE,
	type IndexEnv,
	type IndexTokenStore,
	indexBearerAuth,
} from "../index/auth.ts";
import { readBlockStateWrites } from "../index/state-writes.ts";
import { validateQueryParams } from "../middleware/validation.ts";
import { parseNonNegativeInteger } from "../parse-query.ts";

/**
 * `/v1/proofs/*`: the raw material a client needs to check an Index row
 * against the chain without trusting this API. Every byte is proxied
 * unchanged from two sources:
 *
 *   - the proof sidecar (`marf-witness serve`, private, beside the node):
 *     state witnesses, consensus-hash preimages, Bitcoin headers, and MARF
 *     proofs the node cannot serve. `PROOF_SIDECAR_URL`; unset → 503 on
 *     those routes.
 *   - the Stacks node RPC (`STACKS_NODE_RPC_URL`, the node the API already
 *     reads): signed blocks, epoch 2.x headers and MARF inclusion proofs.
 *
 * Plus one read of the indexer's own `state_writes`: the names of a block's
 * writes, which a client checks against that block's witness.
 *
 * Free: never metered, never refused for credits. Auth is the read-plane
 * rule (any account key hosted; loopback-open / instance token self-hosted).
 * Hosted reads are rate limited per account, witness in its own lower bucket
 * because each one is a MARF walk on the node box.
 */

/** Sliding-window limits per account (hosted only). */
export const PROOFS_RATE_LIMITS = {
	default: { limit: 20, windowMs: 1_000 },
	witness: { limit: 2, windowMs: 1_000 },
} as const;

/** `marf-witness serve` caps a header page at one difficulty period. */
export const MAX_BITCOIN_HEADERS = 2016;

const DEFAULT_NODE_RPC_URL = "http://localhost:20443";
const SIDECAR_TIMEOUT_MS = 60_000;
const NODE_TIMEOUT_MS = 30_000;

export type ProofsRouterOptions = {
	tokens?: IndexTokenStore;
	/** Read per request so the operator's env is authoritative at call time. */
	sidecarUrl?: () => string | undefined;
	nodeRpcUrl?: () => string;
	/** One canonical block's `state_writes`, in ordinal order. */
	readBlockWrites?: typeof readBlockStateWrites;
};

type Bucket = keyof typeof PROOFS_RATE_LIMITS;

function proofsRateLimit(bucket: Bucket): MiddlewareHandler<IndexEnv> {
	const { limit, windowMs } = PROOFS_RATE_LIMITS[bucket];
	return async (c, next) => {
		// Self-host is single-tenant: the operator's own box, no fairness throttle.
		if (!isPlatformMode()) return next();
		const tenant = c.get("indexTenant");
		if (!tenant || tenant.tier === "internal") return next();
		const result = await getRateLimitStore().check(
			`proofs:${bucket}:${tenant.tenant_id}`,
			limit,
			windowMs,
		);
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

/** A 32-byte hash path param: 64 hex, optional `0x`. Returned bare lowercase,
 *  the form the node and sidecar parse. */
function hash32(value: string, name: string): string {
	return hexParam(value, name, 64);
}

function hexParam(value: string, name: string, length: number): string {
	const bare = value.startsWith("0x") ? value.slice(2) : value;
	if (bare.length !== length || !/^[0-9a-fA-F]+$/.test(bare)) {
		throw new ValidationError(
			`${name} must be ${length} hex characters (optional 0x prefix)`,
		);
	}
	return bare.toLowerCase();
}

function requiredQuery(c: Context, name: string): string {
	const value = c.req.query(name);
	if (value === undefined || value === "") {
		throw new ValidationError(`${name} is required`);
	}
	return value;
}

/** Through `c`, so headers already set on it (rate limit) are kept. */
function errorResponse(
	c: Context,
	status: 404 | 502 | 503,
	code: string,
	message: string,
	headers: Record<string, string> = {},
): Response {
	return c.json({ error: message, code }, status, headers);
}

type ProxySpec = {
	/** Names the source in error messages. */
	source: string;
	timeoutMs: number;
	contentType: "application/octet-stream" | "application/json";
	/** Cache directive for a 200. */
	cache: string;
	/** 404 message: what the source has no record of. */
	notFound: string;
	/** Upstream response headers copied onto a 200. */
	passHeaders?: readonly string[];
	/** Answers an upstream 404 instead of NOT_FOUND: the next source to try. */
	onNotFound?: () => Response | Promise<Response>;
};

/**
 * Stream an upstream proof source through. A 200's body is never parsed or
 * buffered: these bytes are what the client verifies. 404 and a busy 503
 * (with its `retry-after`) pass through as the API's error envelope; any other
 * upstream answer, or no answer, is a 502.
 */
async function proxy(c: Context, url: string, spec: ProxySpec) {
	let upstream: Response;
	try {
		upstream = await fetch(url, {
			signal: AbortSignal.any([
				c.req.raw.signal,
				AbortSignal.timeout(spec.timeoutMs),
			]),
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		return errorResponse(
			c,
			502,
			"PROOF_SOURCE_ERROR",
			`could not reach the ${spec.source}: ${reason}`,
		);
	}

	if (upstream.status === 200) {
		const headers: Record<string, string> = {
			"content-type": spec.contentType,
			"cache-control": spec.cache,
		};
		for (const name of spec.passHeaders ?? []) {
			const value = upstream.headers.get(name);
			if (value !== null) headers[name] = value;
		}
		return upstream.body
			? c.body(upstream.body, 200, headers)
			: c.body(null, 200, headers);
	}

	await upstream.body?.cancel();
	if (upstream.status === 404) {
		return spec.onNotFound
			? spec.onNotFound()
			: errorResponse(c, 404, "NOT_FOUND", spec.notFound);
	}
	if (upstream.status === 503) {
		const retryAfter = upstream.headers.get("retry-after");
		return errorResponse(
			c,
			503,
			"PROOF_SOURCE_BUSY",
			`the ${spec.source} is busy; retry shortly`,
			retryAfter ? { "retry-after": retryAfter } : {},
		);
	}
	return errorResponse(
		c,
		502,
		"PROOF_SOURCE_ERROR",
		`the ${spec.source} answered ${upstream.status}`,
	);
}

export function createProofsRouter(opts: ProofsRouterOptions = {}) {
	const sidecarUrl =
		opts.sidecarUrl ??
		(() => process.env.PROOF_SIDECAR_URL?.trim() || undefined);
	const nodeRpcUrl =
		opts.nodeRpcUrl ??
		(() => process.env.STACKS_NODE_RPC_URL?.trim() || DEFAULT_NODE_RPC_URL);

	const sidecar = (
		c: Context,
		path: string,
		spec: Omit<ProxySpec, "source">,
	) => {
		const base = sidecarUrl();
		if (!base) {
			return errorResponse(
				c,
				503,
				"PROOFS_UNAVAILABLE",
				"proofs unavailable on this instance (PROOF_SIDECAR_URL is not set)",
			);
		}
		return proxy(c, `${base.replace(/\/+$/, "")}${path}`, {
			...spec,
			source: "proof sidecar",
		});
	};

	const node = (c: Context, path: string, spec: Omit<ProxySpec, "source">) =>
		proxy(c, `${nodeRpcUrl().replace(/\/+$/, "")}${path}`, {
			...spec,
			source: "stacks node",
		});

	const router = new Hono<IndexEnv>();
	router.use(
		"*",
		indexBearerAuth({ tokens: opts.tokens ?? DEFAULT_INDEX_TOKEN_STORE }),
	);

	const limited = proofsRateLimit("default");

	router.get("/witness/:index_block_hash", proofsRateLimit("witness"), (c) => {
		validateQueryParams(new URL(c.req.url).searchParams, []);
		const id = hash32(c.req.param("index_block_hash"), "index_block_hash");
		return sidecar(c, `/witness/${id}`, {
			notFound: "no state witness for that block",
			timeoutMs: SIDECAR_TIMEOUT_MS,
			contentType: "application/octet-stream",
			cache: IMMUTABLE_CACHE_CONTROL,
			passHeaders: ["x-block-height", "x-state-root"],
		});
	});

	router.get("/burn/:consensus_hash", limited, (c) => {
		validateQueryParams(new URL(c.req.url).searchParams, []);
		const ch = hexParam(c.req.param("consensus_hash"), "consensus_hash", 40);
		// A consensus hash commits to its burn block: the answer never changes.
		return sidecar(c, `/burn/${ch}`, {
			notFound: "no sortition with that consensus hash",
			timeoutMs: SIDECAR_TIMEOUT_MS,
			contentType: "application/json",
			cache: IMMUTABLE_CACHE_CONTROL,
		});
	});

	router.get("/bitcoin-headers", limited, (c) => {
		validateQueryParams(new URL(c.req.url).searchParams, ["from", "count"]);
		const from = parseNonNegativeInteger(requiredQuery(c, "from"), "from");
		const count = parseNonNegativeInteger(requiredQuery(c, "count"), "count");
		if (count < 1 || count > MAX_BITCOIN_HEADERS) {
			throw new ValidationError(
				`count must be between 1 and ${MAX_BITCOIN_HEADERS}`,
			);
		}
		// Heights near the Bitcoin tip can reorg: short cache only.
		return sidecar(c, `/bitcoin/headers?from=${from}&count=${count}`, {
			notFound: "no Bitcoin headers at that height",
			timeoutMs: SIDECAR_TIMEOUT_MS,
			contentType: "application/json",
			cache: MUTABLE_CACHE_CONTROL,
		});
	});

	router.get("/block/height/:height", limited, (c) => {
		validateQueryParams(new URL(c.req.url).searchParams, []);
		const height = parseNonNegativeInteger(c.req.param("height"), "height");
		// The block at a height can change until it is final.
		return node(c, `/v3/blocks/height/${height}`, {
			notFound: "no block at that height",
			timeoutMs: NODE_TIMEOUT_MS,
			contentType: "application/octet-stream",
			cache: MUTABLE_CACHE_CONTROL,
		});
	});

	router.get("/block/:index_block_hash", limited, (c) => {
		validateQueryParams(new URL(c.req.url).searchParams, []);
		const id = hash32(c.req.param("index_block_hash"), "index_block_hash");
		return node(c, `/v3/blocks/${id}`, {
			notFound: "no block with that index_block_hash",
			timeoutMs: NODE_TIMEOUT_MS,
			contentType: "application/octet-stream",
			cache: IMMUTABLE_CACHE_CONTROL,
		});
	});

	router.get("/epoch2-header/:index_block_hash", limited, (c) => {
		validateQueryParams(new URL(c.req.url).searchParams, []);
		const id = hash32(c.req.param("index_block_hash"), "index_block_hash");
		// Pre-Nakamoto blocks have no `/v3/blocks` form. `/v2/headers/1?tip=`
		// is the header plus the consensus hash its id commits to.
		return node(c, `/v2/headers/1?tip=${id}`, {
			notFound: "no epoch 2.x block with that index_block_hash",
			timeoutMs: NODE_TIMEOUT_MS,
			contentType: "application/json",
			cache: IMMUTABLE_CACHE_CONTROL,
		});
	});

	router.get("/writes/:height", limited, async (c) => {
		validateQueryParams(new URL(c.req.url).searchParams, []);
		const height = parseNonNegativeInteger(c.req.param("height"), "height");
		const read = opts.readBlockWrites ?? readBlockStateWrites;
		const writes = await read(height);
		// Every block writes at least its MARF bookkeeping, so no rows means
		// this node never delivered the block's writes (or it is not canonical).
		if (writes.length === 0) {
			return errorResponse(
				c,
				404,
				"NOT_FOUND",
				"no state_writes for a canonical block at that height",
			);
		}
		// The canonical block at a height can change until it is final.
		return c.json({ block_height: height, state_writes: writes }, 200, {
			"cache-control": MUTABLE_CACHE_CONTROL,
		});
	});

	router.get("/marf/:path", limited, (c) => {
		validateQueryParams(new URL(c.req.url).searchParams, ["tip"]);
		const path = hash32(c.req.param("path"), "path");
		const tip = hash32(requiredQuery(c, "tip"), "tip");
		// Pinned to a tip block, the proof is fixed.
		const spec = {
			notFound: "no MARF entry at that path as of tip",
			contentType: "application/json",
			cache: IMMUTABLE_CACHE_CONTROL,
		} as const;
		// The node 404s keys with no stored value string, such as the MARF's
		// own `__MARF_BLOCK_HEIGHT_TO_HASH::<height>`. The sidecar proves any
		// key from the MARF itself, same proof bytes, `data` the raw leaf value.
		const fromSidecar = sidecarUrl()
			? () =>
					sidecar(c, `/marf/${path}?tip=${tip}`, {
						...spec,
						timeoutMs: SIDECAR_TIMEOUT_MS,
					})
			: undefined;
		return node(c, `/v2/clarity/marf/${path}?tip=${tip}&proof=1`, {
			...spec,
			timeoutMs: NODE_TIMEOUT_MS,
			onNotFound: fromSidecar,
		});
	});

	return router;
}

export default createProofsRouter();
