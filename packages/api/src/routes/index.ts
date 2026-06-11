import {
	getProductUsage,
	incrementIndexDecodedEventsReturned,
} from "@secondlayer/platform/db/queries/usage";
import { getDb } from "@secondlayer/shared/db";
import { readChainReorgsForHeightRange } from "@secondlayer/shared/db/queries/chain-reorgs";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import {
	MUTABLE_CACHE_CONTROL,
	cacheControl,
	etag,
	matchesIfNoneMatch,
} from "../http/cache.ts";
import {
	DEFAULT_INDEX_TOKEN_STORE,
	type IndexEnv,
	type IndexTokenStore,
	indexBearerAuth,
} from "../index/auth.ts";
import {
	BLOCKS_FILTERS,
	type BlockByRefReader,
	type BlocksReader,
	getBlocksResponse,
	readBlockByRef,
} from "../index/blocks.ts";
import { indexCachePlan } from "../index/cache.ts";
import {
	CANONICAL_FILTERS,
	type CanonicalRangeReader,
	getCanonicalResponse,
} from "../index/canonical.ts";
import {
	CONTRACT_CALLS_FILTERS,
	type ContractCallsReader,
	getContractCallsResponse,
} from "../index/contract-calls.ts";
import {
	INDEX_EVENT_CONFIG,
	INDEX_EVENT_TYPES,
	type IndexEventsReader,
	getIndexEventsResponse,
} from "../index/events.ts";
import {
	type FtTransfersReader,
	getFtTransfersResponse,
} from "../index/ft-transfers.ts";
import {
	MEMPOOL_FILTERS,
	type MempoolByIdReader,
	type MempoolReader,
	getMempoolResponse,
	readMempoolByTxId,
} from "../index/mempool.ts";
import {
	type NftTransfersReader,
	getNftTransfersResponse,
} from "../index/nft-transfers.ts";
import { indexRateLimit } from "../index/rate-limit.ts";
import {
	STACKING_FILTERS,
	type StackingReader,
	getStackingResponse,
} from "../index/stacking.ts";
import { INDEX_TIER_CONFIG } from "../index/tiers.ts";
import {
	type IndexTip,
	type IndexTipProvider,
	getIndexTip,
} from "../index/tip.ts";
import {
	IncompleteBlockTxSetError,
	ProofNodeUnavailableError,
	getTransactionProofDefault,
} from "../index/transaction-proof.ts";
import {
	TRANSACTIONS_FILTERS,
	type TransactionByIdReader,
	type TransactionsReader,
	getTransactionsResponse,
	readTransactionById,
} from "../index/transactions.ts";
import { validateQueryParams } from "../middleware/validation.ts";
import {
	DEFAULT_STREAMS_REORGS_READER,
	type StreamsReorgsReader,
} from "../streams/reorgs.ts";
import { isX402Enabled } from "../x402/facilitator.ts";
import { x402PaymentRequired } from "../x402/middleware.ts";

const INDEX_COMMON = [
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"contract_id",
	"sender",
	"recipient",
] as const;
const FT_ALLOWED = INDEX_COMMON;
const NFT_ALLOWED = [...INDEX_COMMON, "asset_identifier"] as const;
const EVENTS_ALLOWED = [...INDEX_COMMON, "event_type", "asset_identifier"];

export type IndexRouterOptions = {
	tokens?: IndexTokenStore;
	getTip?: IndexTipProvider;
	readEvents?: IndexEventsReader;
	readContractCalls?: ContractCallsReader;
	readFtTransfers?: FtTransfersReader;
	readNftTransfers?: NftTransfersReader;
	readCanonical?: CanonicalRangeReader;
	readBlocks?: BlocksReader;
	readBlockByRef?: BlockByRefReader;
	readTransactions?: TransactionsReader;
	readTransactionById?: TransactionByIdReader;
	readStacking?: StackingReader;
	readMempool?: MempoolReader;
	readMempoolByTxId?: MempoolByIdReader;
	readReorgs?: StreamsReorgsReader;
	recordDecodedEventsReturned?: (
		accountId: string,
		quantity: number,
	) => Promise<void>;
	/** Pre-built x402 middleware to mount (accountless pay-per-call). Omit to
	 *  disable. Composed at the app root so the route stays free of env +
	 *  facilitator wiring; tests pass a fake-backed instance. */
	x402Middleware?: MiddlewareHandler;
};

/**
 * Apply Index caching to a read response. Sets `Cache-Control` from the finality
 * plan, and for immutable (fully-finalized) pages attaches an ETag over the
 * stable slice — everything except the moving `tip`, so it survives tip
 * movement — and short-circuits to 304 on a matching `If-None-Match` BEFORE
 * metering, since the client already holds the data. Returns the 304 Response to
 * return early, or null to continue. Mirrors the Streams route wiring.
 */
function applyIndexCache(
	c: Context<IndexEnv>,
	query: URLSearchParams,
	tip: IndexTip,
	stableSlice: unknown,
): Response | null {
	const plan = indexCachePlan(query, tip);
	c.header("Cache-Control", plan.cacheControl);
	if (!plan.fullyFinalized) return null;
	const tag = etag(JSON.stringify(stableSlice));
	c.header("ETag", tag);
	if (matchesIfNoneMatch(c.req.header("If-None-Match"), tag)) {
		return c.body(null, 304);
	}
	return null;
}

export function createIndexRouter(opts: IndexRouterOptions = {}) {
	const getTip = opts.getTip ?? getIndexTip;
	const readReorgs = opts.readReorgs ?? DEFAULT_STREAMS_REORGS_READER;
	const recordDecodedEventsReturned =
		opts.recordDecodedEventsReturned ??
		((accountId, quantity) =>
			incrementIndexDecodedEventsReturned(getDb(), accountId, quantity));
	const router = new Hono<IndexEnv>();

	// Discovery — anonymous, lists endpoints + filters.
	router.get("/", (c) =>
		c.json({
			routes: [
				{
					path: "/v1/index/events",
					method: "GET",
					description:
						"Decoded chain events for a chosen event_type, filterable + cursor-paginated. Returns events[], next_cursor, tip, reorgs[].",
					required: ["event_type"],
					event_types: INDEX_EVENT_TYPES,
					filters: EVENTS_ALLOWED,
					// Allowed filters vary by event_type — this map is the precise,
					// machine-readable vocabulary (generated from the event registry, so
					// it can't drift from what the endpoint actually accepts).
					event_type_filters: Object.fromEntries(
						INDEX_EVENT_TYPES.map((t) => {
							const cfg = INDEX_EVENT_CONFIG[t];
							// `trait` is accepted for contract-keyed types (those with a
							// contract_id equality filter) — mirror the parser's rule.
							const traitSupported = (
								cfg.equalityFilters as readonly string[]
							).includes("contract_id");
							return [
								t,
								{
									columns: cfg.columns,
									allowed_filters: traitSupported
										? [...cfg.allowedFilters, "trait"]
										: cfg.allowedFilters,
									equality_filters: cfg.equalityFilters,
									required_non_null: cfg.requiredNonNull,
								},
							];
						}),
					),
				},
				{
					path: "/v1/index/ft-transfers",
					method: "GET",
					description:
						"Alias for /events?event_type=ft_transfer. Fungible token transfers, decoded + filterable.",
					filters: FT_ALLOWED,
				},
				{
					path: "/v1/index/nft-transfers",
					method: "GET",
					description:
						"Alias for /events?event_type=nft_transfer. NFT transfers, decoded + filterable.",
					filters: NFT_ALLOWED,
				},
				{
					path: "/v1/index/contract-calls",
					method: "GET",
					description:
						"Decoded contract-call transactions (function args + result), filterable + cursor-paginated. Returns contract_calls[], next_cursor, tip, reorgs[]. Cursor: <block_height>:<tx_index>.",
					filters: CONTRACT_CALLS_FILTERS,
				},
				{
					path: "/v1/index/canonical",
					method: "GET",
					description:
						"Canonical block-hash map over a height range — one row per height (orphaned blocks excluded) so clients sync only the canonical chain. Returns canonical[] ({block_height, block_hash, parent_hash, burn_block_height, burn_block_hash}), next_cursor, tip.",
					filters: CANONICAL_FILTERS,
				},
				{
					path: "/v1/index/blocks",
					method: "GET",
					description:
						"Canonical blocks, cursor-paginated. Returns blocks[] ({block_height, block_hash, parent_hash, burn_block_height, burn_block_hash, block_time, canonical}), next_cursor, tip.",
					filters: BLOCKS_FILTERS,
				},
				{
					path: "/v1/index/blocks/:height_or_hash",
					method: "GET",
					description:
						"A single block by height (canonical) or by hash (any; check the canonical flag). 404 when absent.",
				},
				{
					path: "/v1/index/transactions",
					method: "GET",
					description:
						"Full transaction documents (fee, nonce, post-conditions, payload detail decoded from raw_tx), filterable by type/sender/contract_id + cursor-paginated. Returns transactions[], next_cursor, tip, reorgs[]. Cursor: <block_height>:<tx_index>.",
					filters: TRANSACTIONS_FILTERS,
				},
				{
					path: "/v1/index/transactions/:tx_id",
					method: "GET",
					description:
						"A single transaction document by tx_id (canonical). 404 when absent.",
				},
				{
					path: "/v1/index/stacking",
					method: "GET",
					description:
						"Decoded PoX-4 stacking actions (stack-stx, delegate-stx, …), filterable by function_name/stacker/caller + cursor-paginated. Returns stacking[], next_cursor, tip. Cursor: <block_height>:<tx_index>.",
					filters: STACKING_FILTERS,
				},
				{
					path: "/v1/index/mempool",
					method: "GET",
					description:
						"Pending (unconfirmed) transaction documents, filterable by sender/type/contract_id + cursor-paginated. Pre-chain: no block_height/result/events, plus received_at. Never cacheable (volatile). Cursor: opaque (base64url envelope, not a block position) — pass back unchanged.",
					filters: MEMPOOL_FILTERS,
				},
				{
					path: "/v1/index/mempool/:tx_id",
					method: "GET",
					description:
						"A single pending transaction by tx_id. 404 when absent (confirmed/dropped txs leave the mempool).",
				},
				{
					path: "/v1/index/usage",
					method: "GET",
					description:
						"Your own Index consumption (decoded events today + this month) and tier limits. Requires a key (anon → 401).",
				},
			],
			auth: "optional bearer for higher rate-limit tier; anon allowed",
			cursor: {
				format: "<block_height>:<event_index>",
				semantics:
					"opaque resume token; pass back unchanged to continue. Equals last event's cursor (inclusive on output, exclusive on input).",
			},
		}),
	);

	router.use(
		"*",
		indexBearerAuth({ tokens: opts.tokens ?? DEFAULT_INDEX_TOKEN_STORE }),
	);
	// x402 rail: mount the injected middleware if present (accountless callers pay
	// per call; keyed callers + the open-beta anon path are unaffected when off).
	// Whether it's enabled is decided at the app root, not here.
	if (opts.x402Middleware) router.use("*", opts.x402Middleware);
	router.use("*", indexRateLimit());

	// An agent's own Index consumption + tier limits. Index reads allow anon, but
	// usage needs an identity — a keyed (Build+) request. Anon → 401.
	router.get("/usage", async (c) => {
		const tenant = c.get("indexTenant");
		if (!tenant?.account_id) {
			return c.json(
				{ error: "Usage requires an API key (Build+ tier)", code: "AUTH" },
				401,
			);
		}
		const usage = await getProductUsage(getDb(), tenant.account_id);
		return c.json({
			product: "index",
			tier: tenant.tier,
			limits: {
				rate_limit_per_second:
					INDEX_TIER_CONFIG[tenant.tier].rateLimitPerSecond,
			},
			usage: {
				decoded_events_today: usage.indexDecodedEventsToday,
				decoded_events_this_month: usage.indexDecodedEventsThisMonth,
			},
		});
	});

	router.get("/events", async (c) => {
		const query = new URL(c.req.url).searchParams;
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getIndexEventsResponse({
			query,
			tip,
			readEvents: opts.readEvents,
			readReorgs,
		});
		const notModified = applyIndexCache(c, query, tip, {
			events: response.events,
			next_cursor: response.next_cursor,
			reorgs: response.reorgs,
		});
		if (notModified) return notModified;
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.events.length > 0) {
			await recordDecodedEventsReturned(accountId, response.events.length);
		}
		return c.json(response);
	});

	router.get("/contract-calls", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, CONTRACT_CALLS_FILTERS);
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getContractCallsResponse({
			query,
			tip,
			readContractCalls: opts.readContractCalls,
			readReorgs: (range) => readChainReorgsForHeightRange(range),
		});
		const notModified = applyIndexCache(c, query, tip, {
			contract_calls: response.contract_calls,
			next_cursor: response.next_cursor,
			reorgs: response.reorgs,
		});
		if (notModified) return notModified;
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.contract_calls.length > 0) {
			await recordDecodedEventsReturned(
				accountId,
				response.contract_calls.length,
			);
		}
		return c.json(response);
	});

	router.get("/canonical", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, CANONICAL_FILTERS);
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getCanonicalResponse({
			query,
			tip,
			readCanonical: opts.readCanonical,
		});
		// The canonical map is cheap sync metadata — served but deliberately not
		// metered as decoded events.
		const notModified = applyIndexCache(c, query, tip, {
			canonical: response.canonical,
			next_cursor: response.next_cursor,
		});
		if (notModified) return notModified;
		return c.json(response);
	});

	router.get("/blocks", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, BLOCKS_FILTERS);
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getBlocksResponse({
			query,
			tip,
			readBlocks: opts.readBlocks,
		});
		const notModified = applyIndexCache(c, query, tip, {
			blocks: response.blocks,
			next_cursor: response.next_cursor,
		});
		if (notModified) return notModified;
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.blocks.length > 0) {
			await recordDecodedEventsReturned(accountId, response.blocks.length);
		}
		return c.json(response);
	});

	router.get("/blocks/:heightOrHash", async (c) => {
		const tip = await getTip();
		c.set("indexTip", tip);
		const read = opts.readBlockByRef ?? readBlockByRef;
		const block = await read(c.req.param("heightOrHash"));
		if (!block) return c.json({ error: "Block not found" }, 404);
		// A point-get is cheap reference data — served but not metered. Immutable
		// once the block is canonical and past finality.
		const finalized =
			block.canonical && block.block_height <= tip.finalized_height;
		c.header("Cache-Control", cacheControl(finalized));
		if (finalized) {
			const tag = etag(JSON.stringify(block));
			c.header("ETag", tag);
			if (matchesIfNoneMatch(c.req.header("If-None-Match"), tag)) {
				return c.body(null, 304);
			}
		}
		return c.json({ block, tip });
	});

	router.get("/transactions", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, TRANSACTIONS_FILTERS);
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getTransactionsResponse({
			query,
			tip,
			readTransactions: opts.readTransactions,
			readReorgs: (range) => readChainReorgsForHeightRange(range),
		});
		const notModified = applyIndexCache(c, query, tip, {
			transactions: response.transactions,
			next_cursor: response.next_cursor,
			reorgs: response.reorgs,
		});
		if (notModified) return notModified;
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.transactions.length > 0) {
			await recordDecodedEventsReturned(
				accountId,
				response.transactions.length,
			);
		}
		return c.json(response);
	});

	router.get("/transactions/:tx_id", async (c) => {
		const tip = await getTip();
		c.set("indexTip", tip);
		const read = opts.readTransactionById ?? readTransactionById;
		const transaction = await read(c.req.param("tx_id"));
		if (!transaction) return c.json({ error: "Transaction not found" }, 404);
		// Point-get: cheap reference data, served but not metered. Immutable once
		// past finality (the reader only returns canonical transactions).
		const finalized = transaction.block_height <= tip.finalized_height;
		c.header("Cache-Control", cacheControl(finalized));
		if (finalized) {
			const tag = etag(JSON.stringify(transaction));
			c.header("ETag", tag);
			if (matchesIfNoneMatch(c.req.header("If-None-Match"), tag)) {
				return c.body(null, 304);
			}
		}
		return c.json({ transaction, tip });
	});

	// Trustless tx-inclusion proof. Returns the raw tx, raw Nakamoto header, and
	// tx-merkle path so a client can verify inclusion against the chain's own
	// commitments via the SDK's `verifyTransactionProof` — no trust in this API.
	// Distinct 3-segment path, so no collision with :tx_id.
	router.get("/transactions/:tx_id/proof", async (c) => {
		let proof: Awaited<ReturnType<typeof getTransactionProofDefault>>;
		try {
			proof = await getTransactionProofDefault(c.req.param("tx_id"));
		} catch (err) {
			if (err instanceof IncompleteBlockTxSetError) {
				return c.json(
					{ error: err.message, code: "PROOF_TX_SET_INCOMPLETE" },
					503,
				);
			}
			if (err instanceof ProofNodeUnavailableError) {
				return c.json(
					{ error: err.message, code: "PROOF_NODE_UNAVAILABLE" },
					503,
				);
			}
			throw err;
		}
		if (!proof) {
			return c.json(
				{
					error: "Transaction or its block not found",
					code: "PROOF_UNAVAILABLE",
				},
				404,
			);
		}
		c.header("Cache-Control", cacheControl(true)); // proofs are immutable
		return c.json(proof);
	});

	router.get("/stacking", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, STACKING_FILTERS);
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getStackingResponse({
			query,
			tip,
			readStacking: opts.readStacking,
			readReorgs: (range) => readChainReorgsForHeightRange(range),
		});
		const notModified = applyIndexCache(c, query, tip, {
			stacking: response.stacking,
			next_cursor: response.next_cursor,
			reorgs: response.reorgs,
		});
		if (notModified) return notModified;
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.stacking.length > 0) {
			await recordDecodedEventsReturned(accountId, response.stacking.length);
		}
		return c.json(response);
	});

	router.get("/mempool", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, MEMPOOL_FILTERS);
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getMempoolResponse({
			query,
			tip,
			readMempool: opts.readMempool,
		});
		// Mempool is permanently volatile — never finalized, so no immutable cache
		// or ETag/304. Short private TTL only.
		c.header("Cache-Control", MUTABLE_CACHE_CONTROL);
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.mempool.length > 0) {
			await recordDecodedEventsReturned(accountId, response.mempool.length);
		}
		return c.json(response);
	});

	router.get("/mempool/:tx_id", async (c) => {
		const tip = await getTip();
		c.set("indexTip", tip);
		const read = opts.readMempoolByTxId ?? readMempoolByTxId;
		const transaction = await read(c.req.param("tx_id"));
		if (!transaction) {
			return c.json({ error: "Pending transaction not found" }, 404);
		}
		c.header("Cache-Control", MUTABLE_CACHE_CONTROL);
		return c.json({ transaction, tip });
	});

	router.get("/ft-transfers", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, FT_ALLOWED);
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getFtTransfersResponse({
			query,
			tip,
			readTransfers: opts.readFtTransfers,
			readReorgs,
		});
		const notModified = applyIndexCache(c, query, tip, {
			events: response.events,
			next_cursor: response.next_cursor,
			reorgs: response.reorgs,
		});
		if (notModified) return notModified;
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.events.length > 0) {
			await recordDecodedEventsReturned(accountId, response.events.length);
		}
		return c.json(response);
	});

	router.get("/nft-transfers", async (c) => {
		const query = new URL(c.req.url).searchParams;
		validateQueryParams(query, NFT_ALLOWED);
		const tip = await getTip();
		c.set("indexTip", tip);
		const response = await getNftTransfersResponse({
			query,
			tip,
			readTransfers: opts.readNftTransfers,
			readReorgs,
		});
		const notModified = applyIndexCache(c, query, tip, {
			events: response.events,
			next_cursor: response.next_cursor,
			reorgs: response.reorgs,
		});
		if (notModified) return notModified;
		const accountId = c.get("indexTenant")?.account_id;
		if (accountId && response.events.length > 0) {
			await recordDecodedEventsReturned(accountId, response.events.length);
		}
		return c.json(response);
	});

	return router;
}

// Composition root: decide x402 from env here, keeping the route factory pure.
export default createIndexRouter({
	x402Middleware: isX402Enabled()
		? x402PaymentRequired({
				surface: "index",
				// First 1,000 anonymous reads per IP per day stay free even with
				// the rail on — the keyless-reads promise survives the flip.
				freeQuota: { limit: 1_000, windowMs: 24 * 60 * 60 * 1000 },
			})
		: undefined,
});
