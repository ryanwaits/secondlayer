import { RateLimitError, ValidationError } from "@secondlayer/shared/errors";
import { isPlatformMode } from "@secondlayer/shared/mode";
import {
	type BitcoinRpcConfig,
	BitcoinSourceError,
	bitcoinRpcSource,
	blockHash,
	buildTxProof,
} from "@secondlayer/stacks/bitcoin";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { getClientIp } from "../auth/http.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import { bitcoinRpcFromEnv } from "../bitcoin/rpc.ts";
import {
	IMMUTABLE_CACHE_CONTROL,
	MUTABLE_CACHE_CONTROL,
	etag,
	matchesIfNoneMatch,
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
 *   - a Bitcoin Core node (`BITCOIN_RPC_URL`): a transaction with its merkle
 *     branch and block header. Unlike the proxied routes this one assembles
 *     its answer, but the client re-checks every byte of it.
 *
 * Plus one read of the indexer's own `state_writes`: the names of a block's
 * writes, which a client checks against that block's witness.
 *
 * Free: never metered, never refused for credits. No key is needed anywhere:
 * the bytes are self-verifying. Hosted reads are rate limited per client IP,
 * higher per account with a key; witness has its own lower bucket because
 * each one is a MARF walk on the node box.
 */

/** Sliding windows (hosted only). An account key buys the higher limit;
 *  anonymous callers share one window per client IP. */
export const PROOFS_RATE_LIMITS = {
	account: {
		default: { limit: 20, windowMs: 1_000 },
		witness: { limit: 2, windowMs: 1_000 },
	},
	anonymous: {
		default: { limit: 10, windowMs: 1_000 },
		witness: { limit: 1, windowMs: 1_000 },
	},
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
	/** Bitcoin Core RPC for `/bitcoin-tx`; undefined → 503. Read per request. */
	bitcoinRpc?: () => BitcoinRpcConfig | undefined;
	/** One canonical block's `state_writes`, in ordinal order. */
	readBlockWrites?: typeof readBlockStateWrites;
};

type Bucket = keyof typeof PROOFS_RATE_LIMITS.account;

function proofsRateLimit(bucket: Bucket): MiddlewareHandler<IndexEnv> {
	return async (c, next) => {
		// Self-host is single-tenant: the operator's own box, no fairness throttle.
		if (!isPlatformMode()) return next();
		const tenant = c.get("indexTenant");
		if (tenant?.tier === "internal") return next();
		const { limit, windowMs } = tenant
			? PROOFS_RATE_LIMITS.account[bucket]
			: PROOFS_RATE_LIMITS.anonymous[bucket];
		const key = tenant
			? `proofs:${bucket}:${tenant.tenant_id}`
			: `proofs:${bucket}:anon:${getClientIp(c)}`;
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

/** Bump when a proof route's response format changes, so cached copies revalidate. */
const PROOF_FORMAT = "1";

/** Immutable answers are a pure function of their (normalized) key, so the
 *  ETag is too: a revalidation never reaches the sidecar or node. */
function immutableTag(key: string): string {
	return etag(`proofs:${PROOF_FORMAT}:${key}`);
}

function notModified(c: Context, tag: string): Response | null {
	if (!matchesIfNoneMatch(c.req.header("if-none-match"), tag)) return null;
	return c.body(null, 304, {
		etag: tag,
		"cache-control": IMMUTABLE_CACHE_CONTROL,
	});
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

const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

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
	/** ETag for a 200 (immutable routes only). */
	etag?: string;
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
		if (spec.etag) headers.etag = spec.etag;
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

	const bitcoinRpc = opts.bitcoinRpc ?? bitcoinRpcFromEnv;

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
	// Proofs are self-verifying bytes, so hosted serves them without a key
	// (deliberate exception to the read-plane rule). A key only raises the limit.
	router.use(
		"*",
		indexBearerAuth({
			tokens: opts.tokens ?? DEFAULT_INDEX_TOKEN_STORE,
			allowAnon: true,
		}),
	);

	const limited = proofsRateLimit("default");

	router.get("/witness/:index_block_hash", proofsRateLimit("witness"), (c) => {
		validateQueryParams(new URL(c.req.url).searchParams, []);
		const id = hash32(c.req.param("index_block_hash"), "index_block_hash");
		const tag = immutableTag(`witness:${id}`);
		const cached = notModified(c, tag);
		if (cached) return cached;
		return sidecar(c, `/witness/${id}`, {
			etag: tag,
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
		const tag = immutableTag(`burn:${ch}`);
		const cached = notModified(c, tag);
		if (cached) return cached;
		return sidecar(c, `/burn/${ch}`, {
			etag: tag,
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

	router.get("/bitcoin-tx/:txid", limited, async (c) => {
		validateQueryParams(new URL(c.req.url).searchParams, []);
		const txid = hash32(c.req.param("txid"), "txid");
		const config = bitcoinRpc();
		if (!config) {
			return errorResponse(
				c,
				503,
				"PROOFS_UNAVAILABLE",
				"bitcoin tx proofs unavailable on this instance (BITCOIN_RPC_URL is not set)",
			);
		}
		const signal = AbortSignal.any([
			c.req.raw.signal,
			AbortSignal.timeout(NODE_TIMEOUT_MS),
		]);
		const doFetch = config.fetch ?? fetch;
		const source = bitcoinRpcSource({
			...config,
			fetch: ((input, init) =>
				doFetch(input, { ...init, signal })) as typeof fetch,
		});
		let proof: Awaited<ReturnType<typeof buildTxProof>>;
		try {
			proof = await buildTxProof(source, { txid });
		} catch (err) {
			// Messages stay generic: transport errors can carry the RPC URL.
			if (err instanceof BitcoinSourceError && err.code === "not-found") {
				return errorResponse(
					c,
					404,
					"NOT_FOUND",
					"no Bitcoin transaction with that txid",
				);
			}
			if (err instanceof BitcoinSourceError && err.code === "unconfirmed") {
				return errorResponse(
					c,
					404,
					"NOT_FOUND",
					"transaction is not in a block yet",
				);
			}
			return errorResponse(
				c,
				502,
				"PROOF_SOURCE_ERROR",
				err instanceof BitcoinSourceError
					? "could not reach bitcoind"
					: "bitcoind returned inconsistent data for that transaction",
			);
		}
		// A shallow block can reorg out: short cache only.
		return c.json(
			{
				txid,
				block_hash: toHex(blockHash(proof.header, { display: true })),
				block_height: proof.height,
				header: toHex(proof.header),
				raw_tx: toHex(proof.rawTx),
				tx_index: proof.merkle.txIndex,
				tx_count: proof.merkle.txCount,
				siblings: proof.merkle.siblings.map(toHex),
			},
			200,
			{ "cache-control": MUTABLE_CACHE_CONTROL },
		);
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
		const tag = immutableTag(`block:${id}`);
		const cached = notModified(c, tag);
		if (cached) return cached;
		return node(c, `/v3/blocks/${id}`, {
			etag: tag,
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
		const tag = immutableTag(`epoch2-header:${id}`);
		const cached = notModified(c, tag);
		if (cached) return cached;
		return node(c, `/v2/headers/1?tip=${id}`, {
			etag: tag,
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
		const tag = immutableTag(`marf:${path}:${tip}`);
		const cached = notModified(c, tag);
		if (cached) return cached;
		const spec = {
			etag: tag,
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
