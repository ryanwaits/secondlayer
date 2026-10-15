/**
 * `POST /v1/chain-read/v2/contracts/call-read/:address/:name/:fn?tip=…`:
 * contract reads for hosted subgraph processors.
 *
 * A hosted tenant stack has no Stacks node, so a handler's `readContractAt`
 * comes here instead, and this api (which has the node) answers it. The path
 * mirrors the node's own `call-read` route and the body is returned verbatim,
 * so the subgraph runtime reuses `readContract` unchanged and a hosted read
 * behaves exactly like a self-hosted one.
 *
 * Untrusted tenant code drives these calls into the node the indexer depends
 * on, so every guard is here:
 * - tenant keys only (`api_keys.product = 'tenant'`); a customer key is 403;
 * - always pinned to a block (`tip` = an index block hash), never the tip;
 * - sender forced to the contract, so the node's work per key is fixed;
 * - path and body validated and capped;
 * - per-account rate limit and concurrency, a global concurrency cap, and a
 *   node timeout;
 * - a shared cache of `okay: true` answers keyed by the pinned block. Only
 *   node answers for pinned keys are cached, never a caller's claim that a
 *   value is constant, so one tenant can't pin a wrong answer for another.
 *
 * Platform only, not a public surface: absent from the OpenAPI document and
 * the API reference. No per-read metering; the limits bound it instead.
 */

import { chainReadArgsHash } from "@secondlayer/shared/chain-read";
import { getSourceDb, sql } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { type Context, Hono } from "hono";
import {
	type ProductTenant,
	createApiKeyTokenStore,
} from "../auth/api-key-store.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import { bearerToken } from "../auth/read-plane.ts";

export const CHAIN_READ_NODE_TIMEOUT_MS = 5_000;
const READS_PER_MINUTE = 3_000;
/** Matches the subgraph runtime's own default read concurrency. */
const ACCOUNT_CONCURRENCY = 4;
/** Per api process: the node's call-read capacity also serves proofs and
 *  sBTC supply. */
const GLOBAL_CONCURRENCY = 16;
/** How long a read waits for a free slot before it is told to back off. */
const SLOT_WAIT_MS = 2_000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_ARGS = 32;
const CACHE_RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const PRUNE_BATCH = 5_000;
const PRUNE_MAX_BATCHES = 20;

const CHAIN_READ_SCOPE = "chain-read";

// c32 standard principal; the zero-hash burn address is the shortest.
const PRINCIPAL_RE = /^S[MNPT][0-9A-HJKMNP-TV-Z]{25,40}$/;
const CONTRACT_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;
// Clarity identifier, minus the one-character operator names no contract
// function uses.
const FUNCTION_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_!?+<>=*/-]{0,127}$/;
const TIP_RE = /^(0x)?[0-9a-fA-F]{64}$/;
const HEX_ARG_RE = /^(0x)?([0-9a-fA-F]{2})*$/;

export type ChainReadRouterOptions = {
	/** The node's RPC base URL. Defaults to `STACKS_NODE_RPC_URL`. */
	nodeUrl?: () => string | undefined;
	fetchImpl?: typeof fetch;
	nodeTimeoutMs?: number;
	readsPerMinute?: number;
};

/** A counting semaphore whose waiters give up after a deadline. */
class Slots {
	private active = 0;
	private readonly waiters: Array<() => void> = [];

	constructor(private readonly limit: number) {}

	get idle(): boolean {
		return this.active === 0 && this.waiters.length === 0;
	}

	acquire(waitMs: number): Promise<boolean> {
		if (this.active < this.limit) {
			this.active++;
			return Promise.resolve(true);
		}
		return new Promise((resolve) => {
			const grant = () => {
				clearTimeout(timer);
				this.active++;
				resolve(true);
			};
			const timer = setTimeout(() => {
				const i = this.waiters.indexOf(grant);
				if (i >= 0) this.waiters.splice(i, 1);
				resolve(false);
			}, waitMs);
			this.waiters.push(grant);
		});
	}

	release(): void {
		this.active--;
		this.waiters.shift()?.();
	}
}

function refuse(
	c: Context,
	status: 400 | 401 | 403 | 429 | 502 | 503 | 504,
	code: string,
	error: string,
) {
	return c.json({ error, code }, status);
}

/**
 * Delete pinned cache entries older than the retention window, oldest first,
 * in batches. Rows are inserted in id order, so the first id newer than the
 * cutoff bounds the scan to the rows being deleted.
 */
export async function pruneChainReadCache(
	db: ReturnType<typeof getSourceDb>,
): Promise<number> {
	let deleted = 0;
	for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch++) {
		const result = await sql`
			DELETE FROM chain_read_cache WHERE id IN (
				SELECT id FROM chain_read_cache
				WHERE index_block_hash IS NOT NULL
					AND id < COALESCE(
						(SELECT id FROM chain_read_cache
						 WHERE created_at >= now() - make_interval(days => ${CACHE_RETENTION_DAYS})
						 ORDER BY id LIMIT 1),
						9223372036854775807
					)
				ORDER BY id
				LIMIT ${PRUNE_BATCH}
			)
		`.execute(db);
		const n = Number(result.numAffectedRows ?? 0n);
		deleted += n;
		if (n < PRUNE_BATCH) break;
	}
	return deleted;
}

export function createChainReadRouter(opts: ChainReadRouterOptions = {}): Hono {
	const nodeUrl =
		opts.nodeUrl ?? (() => process.env.STACKS_NODE_RPC_URL?.trim());
	const fetchImpl = opts.fetchImpl ?? fetch;
	// No static seed tokens: a first-party service credential has no account
	// to rate limit, so only DB-backed tenant keys resolve here.
	const tokens = createApiKeyTokenStore<ProductTenant>({
		staticTokens: new Map(),
		requiredScope: CHAIN_READ_SCOPE,
		product: "chain-read",
	});
	const nodeTimeoutMs = opts.nodeTimeoutMs ?? CHAIN_READ_NODE_TIMEOUT_MS;
	const readsPerMinute = opts.readsPerMinute ?? READS_PER_MINUTE;
	const globalSlots = new Slots(GLOBAL_CONCURRENCY);
	const accountSlots = new Map<string, Slots>();
	let lastPruneAt = 0;

	const maybePrune = () => {
		const now = Date.now();
		if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
		lastPruneAt = now;
		pruneChainReadCache(getSourceDb()).catch((err) =>
			logger.warn("chain-read cache prune failed", {
				error: err instanceof Error ? err.message : String(err),
			}),
		);
	};

	const app = new Hono();

	app.post("/v2/contracts/call-read/:address/:name/:fn", async (c) => {
		const raw = bearerToken(c);
		if (!raw) {
			return refuse(
				c,
				401,
				"AUTHENTICATION_ERROR",
				"Missing or invalid Authorization header",
			);
		}
		const tenant = await tokens.get(raw);
		if (!tenant?.account_id) {
			return refuse(
				c,
				403,
				"CHAIN_READ_TENANT_ONLY",
				"Contract reads here serve hosted subgraphs only. A self-hosted subgraph processor reads its own node: set STACKS_NODE_RPC_URL.",
			);
		}
		const accountId = tenant.account_id;

		const { address, name, fn } = c.req.param();
		if (
			!PRINCIPAL_RE.test(address) ||
			!CONTRACT_NAME_RE.test(name) ||
			!FUNCTION_NAME_RE.test(fn)
		) {
			return refuse(
				c,
				400,
				"CHAIN_READ_INVALID",
				"Path must be /v2/contracts/call-read/<principal>/<contract-name>/<function-name>.",
			);
		}

		const tipParam = c.req.query("tip");
		if (!tipParam || !TIP_RE.test(tipParam)) {
			return refuse(
				c,
				400,
				"CHAIN_READ_UNPINNED",
				"tip must be the 64-hex index block hash of the block being processed.",
			);
		}
		const tip = `0x${tipParam.replace(/^0x/, "").toLowerCase()}`;

		const declaredLength = Number(c.req.header("content-length") ?? 0);
		if (declaredLength > MAX_BODY_BYTES) {
			return refuse(c, 400, "CHAIN_READ_INVALID", "Body is over 16 KB.");
		}
		const text = await c.req.text();
		if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
			return refuse(c, 400, "CHAIN_READ_INVALID", "Body is over 16 KB.");
		}
		let parsed: unknown;
		try {
			parsed = text.length === 0 ? {} : JSON.parse(text);
		} catch {
			return refuse(c, 400, "CHAIN_READ_INVALID", "Body is not JSON.");
		}
		const args =
			typeof parsed === "object" && parsed !== null
				? ((parsed as { arguments?: unknown }).arguments ?? [])
				: undefined;
		if (
			!Array.isArray(args) ||
			args.length > MAX_ARGS ||
			!args.every((a) => typeof a === "string" && HEX_ARG_RE.test(a))
		) {
			return refuse(
				c,
				400,
				"CHAIN_READ_INVALID",
				`arguments must be at most ${MAX_ARGS} hex-serialized Clarity values.`,
			);
		}
		const hexArgs = args as string[];

		const limit = await getRateLimitStore().check(
			`chain-read:${accountId}`,
			readsPerMinute,
			60_000,
		);
		if (!limit.allowed) {
			c.header("Retry-After", String(Math.max(1, limit.retryAfter)));
			return refuse(
				c,
				429,
				"CHAIN_READ_RATE_LIMITED",
				`Over ${readsPerMinute} contract reads a minute for this account.`,
			);
		}

		const db = getSourceDb();
		const contractId = `${address}.${name}`;
		const argsHash = chainReadArgsHash(hexArgs);
		const cached = await db
			.selectFrom("chain_read_cache")
			.select("result_hex")
			.where("contract_id", "=", contractId)
			.where("function_name", "=", fn)
			.where("args_hash", "=", argsHash)
			.where("index_block_hash", "=", tip)
			.executeTakeFirst();
		if (cached) return c.json({ okay: true, result: cached.result_hex });

		const base = nodeUrl();
		if (!base) {
			return refuse(
				c,
				503,
				"CHAIN_READ_UNAVAILABLE",
				"This instance has no Stacks node to read from.",
			);
		}

		let slots = accountSlots.get(accountId);
		if (!slots) {
			slots = new Slots(ACCOUNT_CONCURRENCY);
			accountSlots.set(accountId, slots);
		}
		const account = slots;
		if (!(await account.acquire(SLOT_WAIT_MS))) {
			c.header("Retry-After", "1");
			return refuse(
				c,
				429,
				"CHAIN_READ_BUSY",
				`More than ${ACCOUNT_CONCURRENCY} contract reads in flight for this account.`,
			);
		}
		try {
			if (!(await globalSlots.acquire(SLOT_WAIT_MS))) {
				c.header("Retry-After", "1");
				return refuse(
					c,
					429,
					"CHAIN_READ_BUSY",
					"The node is busy; retry shortly.",
				);
			}
			try {
				const url = `${base.replace(/\/+$/, "")}/v2/contracts/call-read/${encodeURIComponent(address)}/${encodeURIComponent(name)}/${encodeURIComponent(fn)}?tip=${tip}`;
				let res: Response;
				try {
					res = await fetchImpl(url, {
						method: "POST",
						headers: { "content-type": "application/json" },
						// The caller's sender is ignored: every read runs as the
						// contract, `readContract`'s own default.
						body: JSON.stringify({ sender: address, arguments: hexArgs }),
						signal: AbortSignal.timeout(nodeTimeoutMs),
					});
				} catch (err) {
					const timedOut =
						err instanceof Error &&
						(err.name === "TimeoutError" || err.name === "AbortError");
					return timedOut
						? refuse(
								c,
								504,
								"CHAIN_READ_TIMEOUT",
								`The node did not answer within ${nodeTimeoutMs / 1000} s.`,
							)
						: refuse(
								c,
								502,
								"CHAIN_READ_NODE_ERROR",
								"The node could not be reached.",
							);
				}

				const body = res.ok
					? ((await res.json().catch(() => null)) as {
							okay?: unknown;
							result?: unknown;
							cause?: unknown;
						} | null)
					: null;
				if (
					!body ||
					typeof body.okay !== "boolean" ||
					(body.okay && typeof body.result !== "string")
				) {
					return refuse(
						c,
						502,
						"CHAIN_READ_NODE_ERROR",
						`The node answered ${res.status} without a call-read result.`,
					);
				}

				if (body.okay) {
					await db
						.insertInto("chain_read_cache")
						.values({
							contract_id: contractId,
							function_name: fn,
							args_hash: argsHash,
							index_block_hash: tip,
							// The route knows the block id, not its height.
							block_height: null,
							result_hex: body.result as string,
						})
						.onConflict((oc) => oc.doNothing())
						.execute()
						.catch((err) =>
							logger.warn("chain-read cache write failed", {
								error: err instanceof Error ? err.message : String(err),
							}),
						);
					maybePrune();
				}
				return c.json(body);
			} finally {
				globalSlots.release();
			}
		} finally {
			account.release();
			if (account.idle) accountSlots.delete(accountId);
		}
	});

	return app;
}

export default createChainReadRouter();
