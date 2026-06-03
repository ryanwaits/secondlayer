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
 * The Index event_types the loader must fetch. A contract_call/contract_deploy
 * source matches a tx and hands its FULL event set to the handler, so when one
 * is present we fetch every event type (the matched tx's events must be
 * complete); otherwise just the referenced event types.
 */
function referencedIndexEventTypes(subgraph: SubgraphDefinition): string[] {
	const filters = sourceFilters(subgraph);
	if (filters.some((f) => TX_SOURCE_TYPES.has(f.type))) {
		return ALL_INDEX_EVENT_TYPES;
	}
	const types = new Set<string>();
	for (const f of filters) {
		const t = EVENT_FILTER_TO_INDEX_TYPE[f.type];
		if (t) types.add(t);
	}
	return [...types];
}

/**
 * streams-index eligibility: sources must be event-types or contract_call/
 * contract_deploy, with no trait scope (resolved from the registry — Phase-2
 * trait-over-HTTP lifts this) and no array-style (filterless `*`) sources
 * (which leak the unreconstructable `_eventId`). Everything else stays on the
 * DB tap.
 */
export function isStreamsIndexEligible(subgraph: SubgraphDefinition): boolean {
	if (Array.isArray(subgraph.sources)) return false;
	const filters = sourceFilters(subgraph);
	if (filters.length === 0) return false;
	for (const f of filters) {
		const known =
			EVENT_FILTER_TO_INDEX_TYPE[f.type] || TX_SOURCE_TYPES.has(f.type);
		if (!known) return false;
		if ((f as { trait?: string }).trait) return false;
	}
	return true;
}

/** Streams clock + Index data plane, reconstructed into raw BlockData rows. */
export class PublicApiBlockSource implements BlockSource {
	constructor(
		private readonly http: IndexHttpClient,
		private readonly eventTypes: string[],
	) {}

	getTip(): Promise<number> {
		return this.http.getTip();
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

const postgresBlockSource = new PostgresBlockSource();

function buildHttpClient(): IndexHttpClient {
	const baseUrl =
		process.env.SUBGRAPH_INDEX_API_URL ??
		process.env.STREAMS_API_URL ??
		"http://api:3800";
	return new IndexHttpClient({
		indexBaseUrl: baseUrl,
		streamsBaseUrl: baseUrl,
		streamsApiKey:
			process.env.STREAMS_INTERNAL_API_KEY ?? "sk-sl_streams_l2_internal",
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
		return new PublicApiBlockSource(
			buildHttpClient(),
			referencedIndexEventTypes(subgraph),
		);
	}
	if (process.env.SUBGRAPH_SOURCE === "streams-index" && subgraph) {
		logger.debug("Subgraph not streams-index eligible, using DB tap", {
			subgraph: subgraph.name,
		});
	}
	return postgresBlockSource;
}
