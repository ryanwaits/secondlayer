import { getSourceDb } from "@secondlayer/shared/db";
import { IndexHttpClient } from "@secondlayer/shared/index-http";
import { logger } from "@secondlayer/shared/logger";
import type { SubgraphDefinition, SubgraphFilter } from "../types.ts";
import { type BlockData, loadBlockRange } from "./batch-loader.ts";
import {
	reconstructBlock,
	reconstructEvent,
	reconstructTransaction,
} from "./reconstruct.ts";

/**
 * Where the subgraph runtime reads canonical chain data. Today it taps the
 * indexer Postgres directly (`PostgresBlockSource`); the re-point adds a
 * `PublicApiBlockSource` that consumes the Streams clock + Index data over
 * HTTP. `matchSources` / handlers / flush / outbox are unchanged — only the
 * loader + tip swap behind this seam.
 */
export interface BlockSource {
	/** Highest canonical block height available to process. */
	getTip(): Promise<number>;
	/** Canonical block data for [fromHeight, toHeight], keyed by height. */
	loadBlockRange(
		fromHeight: number,
		toHeight: number,
	): Promise<Map<number, BlockData>>;
	/** Sparse-scan probe: lowest height in (afterHeight, untilHeight] holding
	 *  an event this source's subgraph could match, or null when the rest of
	 *  the range is empty. Optional — only event-scoped sources support it. */
	nextDataHeight?(
		afterHeight: number,
		untilHeight: number,
	): Promise<number | null>;
}

/** A (decoded event type, optional contract scope) pair the sparse probe
 *  checks. Contract scoping is what makes token-subgraph reindexes leap over
 *  everything that isn't their token. */
export type SparseProbeTarget = { eventType: string; contractId?: string };

/** Sparse scanning is sound only when EVERY source is an event-type filter —
 *  a contract_call/contract_deploy source matches transactions, which the
 *  event probe can't see. */
export function canSparseScan(subgraph: SubgraphDefinition): boolean {
	if (Array.isArray(subgraph.sources)) return false;
	const filters = sourceFilters(subgraph);
	if (filters.length === 0) return false;
	return filters.every((f) => Boolean(EVENT_FILTER_TO_INDEX_TYPE[f.type]));
}

/** Probe targets for a subgraph's filters: decoded type + contract scope when
 *  the filter pins one (assetIdentifier "SP….contract::asset" or contractId). */
export function sparseProbeTargets(
	subgraph: SubgraphDefinition,
): SparseProbeTarget[] {
	const targets = new Map<string, SparseProbeTarget>();
	for (const f of sourceFilters(subgraph)) {
		const eventType = EVENT_FILTER_TO_INDEX_TYPE[f.type];
		if (!eventType) continue;
		const scoped = f as { assetIdentifier?: string; contractId?: string };
		const contractId =
			scoped.contractId ?? scoped.assetIdentifier?.split("::")[0];
		const key = `${eventType}|${contractId ?? ""}`;
		targets.set(key, { eventType, ...(contractId ? { contractId } : {}) });
	}
	return [...targets.values()];
}

/** Reads directly from the shared indexer Postgres (the original behavior). */
export class PostgresBlockSource implements BlockSource {
	async getTip(): Promise<number> {
		const progress = await getSourceDb()
			.selectFrom("index_progress")
			.selectAll()
			.where("network", "=", process.env.NETWORK ?? "mainnet")
			.executeTakeFirst();
		return progress ? Number(progress.highest_seen_block) : 0;
	}

	loadBlockRange(
		fromHeight: number,
		toHeight: number,
	): Promise<Map<number, BlockData>> {
		return loadBlockRange(getSourceDb(), fromHeight, toHeight);
	}
}

// Subgraph source filter types that map to a decoded Index event_type. The
// `_event` suffix is the runtime's raw form; print is keyed `print_event`.
const EVENT_FILTER_TO_INDEX_TYPE: Record<string, string> = {
	stx_transfer: "stx_transfer",
	stx_mint: "stx_mint",
	stx_burn: "stx_burn",
	stx_lock: "stx_lock",
	ft_transfer: "ft_transfer",
	ft_mint: "ft_mint",
	ft_burn: "ft_burn",
	nft_transfer: "nft_transfer",
	nft_mint: "nft_mint",
	nft_burn: "nft_burn",
	print_event: "print",
};

// Tx-level source types — matched against /v1/index/transactions, not events.
const TX_SOURCE_TYPES = new Set(["contract_call", "contract_deploy"]);
const ALL_INDEX_EVENT_TYPES = [
	...new Set(Object.values(EVENT_FILTER_TO_INDEX_TYPE)),
];

function sourceFilters(subgraph: SubgraphDefinition): SubgraphFilter[] {
	const sources = subgraph.sources;
	return Array.isArray(sources)
		? (sources as SubgraphFilter[])
		: Object.values(sources as Record<string, SubgraphFilter>);
}

/**
 * The Index event_types the loader must fetch for a set of source filter types.
 * A contract_call/contract_deploy source matches a tx and hands its FULL event
 * set to the handler, so when one is present we fetch every event type (the
 * matched tx's events must be complete); otherwise just the referenced types.
 * Shared by the subgraph loader and the chain-trigger evaluator.
 */
export function indexEventTypesForFilterTypes(filterTypes: string[]): string[] {
	if (filterTypes.some((t) => TX_SOURCE_TYPES.has(t))) {
		return ALL_INDEX_EVENT_TYPES;
	}
	const types = new Set<string>();
	for (const t of filterTypes) {
		const indexType = EVENT_FILTER_TO_INDEX_TYPE[t];
		if (indexType) types.add(indexType);
	}
	return [...types];
}

function referencedIndexEventTypes(subgraph: SubgraphDefinition): string[] {
	return indexEventTypesForFilterTypes(
		sourceFilters(subgraph).map((f) => f.type),
	);
}

/**
 * streams-index eligibility: every source must be a known event-type or
 * contract_call/contract_deploy filter (no array-style sources, which leak the
 * unreconstructable `_eventId`). Trait scope IS allowed — trait resolution
 * reads the contract registry on the platform DB (`targetDb`), which the
 * processor always holds, so it's source-independent. Everything else stays on
 * the DB tap.
 */
export function isStreamsIndexEligible(subgraph: SubgraphDefinition): boolean {
	if (Array.isArray(subgraph.sources)) return false;
	const filters = sourceFilters(subgraph);
	if (filters.length === 0) return false;
	for (const f of filters) {
		const known =
			EVENT_FILTER_TO_INDEX_TYPE[f.type] || TX_SOURCE_TYPES.has(f.type);
		if (!known) return false;
	}
	return true;
}

/** Streams clock + Index data plane, reconstructed into raw BlockData rows. */
export class PublicApiBlockSource implements BlockSource {
	constructor(
		private readonly http: IndexHttpClient,
		private readonly eventTypes: string[],
		/** When set, enables the sparse-scan probe (event-scoped subgraphs). */
		private readonly probeTargets?: SparseProbeTarget[],
	) {}

	/** Lowest height in (after, until] any probe target hits, or null. */
	async nextDataHeight(
		afterHeight: number,
		untilHeight: number,
	): Promise<number | null> {
		if (!this.probeTargets?.length) return afterHeight + 1;
		const hits = await Promise.all(
			this.probeTargets.map((t) =>
				this.http.firstEventHeight(
					t.eventType,
					afterHeight + 1,
					untilHeight,
					t.contractId,
				),
			),
		);
		const found = hits.filter((h): h is number => h !== null);
		return found.length ? Math.min(...found) : null;
	}

	getTip(): Promise<number> {
		// Bound advancement to what the Index data plane can serve — never
		// process past it even if the Streams clock is ahead.
		return this.http.getIndexTip();
	}

	async loadBlockRange(
		fromHeight: number,
		toHeight: number,
	): Promise<Map<number, BlockData>> {
		const [blocks, txs, eventLists] = await Promise.all([
			this.http.walkBlocks(fromHeight, toHeight),
			this.http.walkTransactions(fromHeight, toHeight),
			Promise.all(
				this.eventTypes.map((t) =>
					this.http.walkEvents(t, fromHeight, toHeight),
				),
			),
		]);

		const map = new Map<number, BlockData>();
		// Seed every canonical height (incl. empty blocks) so catch-up doesn't
		// file them as gaps.
		for (const b of blocks) {
			map.set(b.block_height, {
				block: reconstructBlock(b),
				txs: [],
				events: [],
			});
		}
		for (const t of txs) {
			map.get(t.block_height)?.txs.push(reconstructTransaction(t));
		}
		for (const list of eventLists) {
			for (const e of list) {
				map.get(e.block_height)?.events.push(reconstructEvent(e));
			}
		}
		// Canonical ordering — multi-type event walks merge here.
		for (const bd of map.values()) {
			bd.txs.sort((a, b) => a.tx_index - b.tx_index);
			bd.events.sort((a, b) => a.event_index - b.event_index);
		}
		return map;
	}
}

/**
 * Wraps a primary source and falls back to a secondary, per call, when the
 * primary throws. Use it to make the HTTP (Streams+Index) plane a SOFT dependency:
 * if api is unavailable, the processor reads the Postgres tap and keeps advancing
 * instead of stalling. Safe to mix mid-stream — both taps read the same canonical
 * chain at the same heights and the cursor is forward-only. Stateless (no breaker)
 * so it's failover-safe across replicas; the primary is retried every call and
 * resumes transparently once healthy.
 */
export class FallbackBlockSource implements BlockSource {
	constructor(
		private readonly primary: BlockSource,
		private readonly fallback: BlockSource,
	) {}

	async getTip(): Promise<number> {
		try {
			return await this.primary.getTip();
		} catch (err) {
			logger.warn("block source primary getTip failed — using DB tap", {
				error: err instanceof Error ? err.message : String(err),
			});
			return this.fallback.getTip();
		}
	}

	async loadBlockRange(
		fromHeight: number,
		toHeight: number,
	): Promise<Map<number, BlockData>> {
		try {
			return await this.primary.loadBlockRange(fromHeight, toHeight);
		} catch (err) {
			logger.warn("block source primary loadBlockRange failed — using DB tap", {
				from: fromHeight,
				to: toHeight,
				error: err instanceof Error ? err.message : String(err),
			});
			return this.fallback.loadBlockRange(fromHeight, toHeight);
		}
	}

	/** Probe via the primary only; a probe failure just means "no skip" —
	 *  the caller falls back to plain batch advancement. */
	async nextDataHeight(
		afterHeight: number,
		untilHeight: number,
	): Promise<number | null> {
		if (!this.primary.nextDataHeight) return afterHeight + 1;
		try {
			return await this.primary.nextDataHeight(afterHeight, untilHeight);
		} catch {
			return afterHeight + 1;
		}
	}
}

const postgresBlockSource = new PostgresBlockSource();

/**
 * HTTP (Streams+Index) chain source for a set of decoded event types, wrapped so
 * it falls back to the Postgres tap when api is down. Used by the chain-trigger
 * evaluator (which isn't subgraph-scoped, so it can't go through resolveBlockSource).
 */
export function buildChainBlockSource(eventTypes: string[]): BlockSource {
	return new FallbackBlockSource(
		new PublicApiBlockSource(buildHttpClient(), eventTypes),
		postgresBlockSource,
	);
}

export function buildHttpClient(): IndexHttpClient {
	const baseUrl =
		process.env.SUBGRAPH_INDEX_API_URL ??
		process.env.STREAMS_API_URL ??
		"http://api:3800";
	return new IndexHttpClient({
		indexBaseUrl: baseUrl,
		streamsBaseUrl: baseUrl,
		streamsApiKey:
			process.env.STREAMS_INTERNAL_API_KEY ?? "sk-sl_streams_decode_internal",
	});
}

/**
 * Resolve the block source for a subgraph. `SUBGRAPH_SOURCE=streams-index`
 * opts eligible subgraphs onto the public Streams clock + Index data; everything
 * else (and the default) stays on the Postgres tap.
 */
export function resolveBlockSource(subgraph?: SubgraphDefinition): BlockSource {
	if (
		process.env.SUBGRAPH_SOURCE === "streams-index" &&
		subgraph &&
		isStreamsIndexEligible(subgraph)
	) {
		// Soft-depend on api: fall back to the Postgres tap per-call if the HTTP
		// plane is down, so the processor keeps advancing instead of stalling.
		return new FallbackBlockSource(
			new PublicApiBlockSource(
				buildHttpClient(),
				referencedIndexEventTypes(subgraph),
				canSparseScan(subgraph) ? sparseProbeTargets(subgraph) : undefined,
			),
			postgresBlockSource,
		);
	}
	if (process.env.SUBGRAPH_SOURCE === "streams-index" && subgraph) {
		logger.debug("Subgraph not streams-index eligible, using DB tap", {
			subgraph: subgraph.name,
		});
	}
	return postgresBlockSource;
}
