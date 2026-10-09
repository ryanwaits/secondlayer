import { getSourceDb } from "@secondlayer/shared/db";
import type { Transaction } from "@secondlayer/shared/db";
import {
	BillingPausedError,
	type IndexEventRow,
	type IndexHttpClient,
	type IndexStateWriteRow,
	type IndexTransactionRow,
	createInternalIndexHttpClient,
} from "@secondlayer/shared/index-http";
import { logger } from "@secondlayer/shared/logger";
import type { SubgraphDefinition, SubgraphFilter } from "../types.ts";
import { deriveVerification } from "../verification.ts";
import {
	type BlockData,
	type StateWriteFeed,
	loadBlockRange,
	stateWriteBlocks,
} from "./batch-loader.ts";
import { ObserverHttpBlockSource } from "./observer-http-source.ts";
import { runsInRealm } from "./realm.ts";
import {
	reconstructBlock,
	reconstructEvent,
	reconstructTransaction,
	reconstructTxFromEventRow,
} from "./reconstruct.ts";
import type { TxRecord } from "./source-matcher.ts";
import type { StateWriteRow } from "./state-writes.ts";

/**
 * Where the subgraph runtime reads canonical chain data. Today it taps the
 * indexer Postgres directly (`PostgresBlockSource`); the re-point adds a
 * `PublicApiBlockSource` that consumes the Streams clock + Index data over
 * HTTP. `matchSources` / handlers / flush / outbox are unchanged — only the
 * loader + tip swap behind this seam.
 */
export interface BlockSource {
	/**
	 * Highest canonical block height available to process.
	 *
	 * `opts` is an HTTP-plane long-poll hint, ignored by any
	 * source with no such notion (the Postgres tap: a local DB read is already
	 * instant, nothing to wait on). `knownHeight` is the last tip THIS caller
	 * observed; passing `wait` without it is a no-op — the server needs a
	 * baseline to decide whether anything has changed.
	 */
	getTip(opts?: { wait?: number; knownHeight?: number }): Promise<number>;
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
	/**
	 * Per-decoder committed heights from the SAME response `getTip()` just
	 * fetched (no extra request) — undefined for a source with no such notion
	 * (the Postgres tap: local mode reads `decoder_checkpoints` directly and
	 * never needs this). Lets a caller (the chain evaluator) narrow its own
	 * bound to the decoders it actually reads instead of `getTip()`'s
	 * conservative cross-decoder floor. Call AFTER `getTip()`.
	 */
	getDecodedHeights?(): Record<string, number | null> | undefined;
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

/** Most contracts one filter may pin before it is treated as unscoped (the
 *  Index list-filter ceiling; beyond it a per-contract walk fan-out costs more
 *  than it saves). */
const MAX_PINNED_CONTRACTS = 20;

/**
 * Concrete contract ids a filter pins, or null when it pins none the Index can
 * be asked for. Wildcards, trait scope and factory scope resolve per block
 * against registry state the Index cannot see, so they stay unscoped: scoping
 * them would change which events a handler receives.
 */
function pinnedContracts(filter: SubgraphFilter): string[] | null {
	const f = filter as {
		contractId?: string | readonly string[];
		assetIdentifier?: string;
		trait?: unknown;
		factory?: unknown;
	};
	if (f.trait || f.factory) return null;
	const ids = Array.isArray(f.contractId)
		? [...f.contractId]
		: f.contractId
			? [f.contractId as string]
			: f.assetIdentifier
				? [f.assetIdentifier.split("::")[0] as string]
				: [];
	if (ids.length === 0 || ids.length > MAX_PINNED_CONTRACTS) return null;
	if (ids.some((id) => !id || id.includes("*"))) return null;
	return ids;
}

/**
 * The (decoded event type, contract scope) pairs a subgraph's filters can
 * match. One function feeds BOTH the sparse probe and the event walks, so a
 * new contract-pinning filter field is added here once.
 *
 * Per event type: if ANY filter for it is unscoped, a single unscoped target
 * covers everything (today's behavior); otherwise one target per distinct
 * pinned contract.
 */
export function sparseProbeTargets(
	subgraph: SubgraphDefinition,
): SparseProbeTarget[] {
	const byType = new Map<string, Set<string> | "all">();
	for (const f of sourceFilters(subgraph)) {
		const eventType = EVENT_FILTER_TO_INDEX_TYPE[f.type];
		if (!eventType) continue;
		const pinned = pinnedContracts(f);
		const prev = byType.get(eventType);
		if (!pinned || prev === "all") {
			byType.set(eventType, "all");
			continue;
		}
		const set = prev ?? new Set<string>();
		for (const id of pinned) set.add(id);
		byType.set(eventType, set);
	}
	const targets: SparseProbeTarget[] = [];
	for (const [eventType, scope] of byType) {
		if (scope === "all") targets.push({ eventType });
		else
			for (const contractId of scope) targets.push({ eventType, contractId });
	}
	return targets;
}

/** Lowest height this instance holds `state_writes` for; null when none. */
export type StateWritesCoverage = () => Promise<number | null>;

/** How long a coverage answer is reused. Coverage only appears (the node
 *  starts delivering `state_writes`) or reaches lower (a backfill). */
const COVERAGE_TTL_MS = 60_000;

/** A coverage read cached per process; `forget` drops the cached answer. */
export type CachedCoverage = StateWritesCoverage & { forget(): void };

/** Cache a coverage read per process; a failed read counts as no coverage. */
export function cachedCoverage(
	read: () => Promise<number | null>,
	ttlMs: number = COVERAGE_TTL_MS,
): CachedCoverage {
	let cached: { at: number; value: Promise<number | null> } | undefined;
	const coverage = () => {
		const now = Date.now();
		if (!cached || now - cached.at > ttlMs) {
			cached = { at: now, value: read().catch(() => null) };
		}
		return cached.value;
	};
	return Object.assign(coverage, {
		forget: () => {
			cached = undefined;
		},
	});
}

/** The DB tap's coverage: the lowest `state_writes` height, one PK probe. */
export const dbStateWritesCoverage: CachedCoverage = cachedCoverage(
	async () => {
		const row = await getSourceDb()
			.selectFrom("state_writes")
			.select("block_height")
			.orderBy("block_height", "asc")
			.limit(1)
			.executeTakeFirst();
		return row ? Number(row.block_height) : null;
	},
);

let httpCoverage: StateWritesCoverage | undefined;
/** The Index API's coverage: the first `/v1/index/state-writes` row. */
function httpStateWritesCoverage(): StateWritesCoverage {
	httpCoverage ??= cachedCoverage(() =>
		buildHttpClient().firstStateWriteHeight(),
	);
	return httpCoverage;
}

/**
 * The contracts whose writes a state subgraph would read from `state_writes`,
 * or null when it keeps `vm_events` whatever the instance holds.
 *
 * Only a subgraph running in the deterministic realm (stored level `state`)
 * whose sources the CURRENT rules still derive as `state`. A subgraph stored
 * as `state` before `map_insert` dropped to `events` keeps its `vm_events`
 * feed: `state_writes` cannot tell an insert from a set, so it would silently
 * lose those events.
 */
export function stateWriteContracts(
	subgraph: SubgraphDefinition | undefined,
): StateWriteFeed | null {
	if (!subgraph || !runsInRealm(subgraph)) return null;
	if (deriveVerification(subgraph).level !== "state") return null;
	const contracts = new Set<string>();
	for (const f of sourceFilters(subgraph)) {
		const pinned = pinnedContracts(f);
		// A source with no fixed contract (wildcard, factory) needs every
		// contract's writes.
		if (!pinned) return { contracts: null };
		for (const id of pinned) contracts.add(id);
	}
	return { contracts: [...contracts] };
}

/**
 * The `state_writes` feed for a subgraph, or null when it keeps today's
 * `vm_events` feed. Derived, never configured: a state subgraph switches only
 * once this instance holds `state_writes` from the subgraph's `startBlock`
 * on, so a node that does not deliver them (or started delivering them after
 * the subgraph's range began) changes nothing.
 */
export async function stateWriteFeed(
	subgraph: SubgraphDefinition | undefined,
	coverage: StateWritesCoverage = dbStateWritesCoverage,
): Promise<StateWriteFeed | null> {
	const feed = stateWriteContracts(subgraph);
	if (!feed) return null;
	const from = await coverage();
	if (from === null || from > (subgraph?.startBlock ?? 0)) return null;
	return feed;
}

/** Reads directly from the shared indexer Postgres (the original behavior). */
export class PostgresBlockSource implements BlockSource {
	/** `feed`: read write events from `state_writes` (see {@link stateWriteFeed}). */
	constructor(private readonly feed?: StateWriteFeed | undefined) {}

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
		return loadBlockRange(getSourceDb(), fromHeight, toHeight, {
			stateWrites: this.feed,
		});
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
	nested_contract_call: "nested_contract_call",
	var_set: "var_set",
	map_set: "map_set",
	map_insert: "map_insert",
	map_delete: "map_delete",
};

// Tx-level source types — matched against /v1/index/transactions, not events.
const TX_SOURCE_TYPES = new Set(["contract_call", "contract_deploy"]);
// Second clock (ordinal). Never part of a tx's classic event set: a
// contract_call/contract_deploy source fetches every CLASSIC type, and vm
// types are fetched only when a vm source names them.
export const VM_INDEX_EVENT_TYPES: ReadonlySet<string> = new Set([
	"nested_contract_call",
	"var_set",
	"map_set",
	"map_insert",
	"map_delete",
]);
const CLASSIC_INDEX_EVENT_TYPES = [
	...new Set(Object.values(EVENT_FILTER_TO_INDEX_TYPE)),
].filter((t) => !VM_INDEX_EVENT_TYPES.has(t));

function sourceFilters(subgraph: SubgraphDefinition): SubgraphFilter[] {
	const sources = subgraph.sources;
	return Array.isArray(sources)
		? (sources as SubgraphFilter[])
		: Object.values(sources as Record<string, SubgraphFilter>);
}

/**
 * True when any source matches transactions (contract_call / contract_deploy):
 * the handler receives the full tx, so the loader must fetch real transactions.
 * Event-only subgraphs skip walkTransactions and synthesize the tx from joined
 * event context instead (the ~37x reindex over-fetch; see indexing-speed plan).
 */
export function needsTransactionData(subgraph: SubgraphDefinition): boolean {
	return sourceFilters(subgraph).some((f) => TX_SOURCE_TYPES.has(f.type));
}

/** Build the (few) event-bearing txs from joined event context, one per tx_id —
 *  the event-only replacement for draining every transaction in the range. */
function synthesizeTxsFromEvents(events: IndexEventRow[]): Transaction[] {
	const byId = new Map<string, Transaction>();
	for (const e of events) {
		if (!byId.has(e.tx_id)) byId.set(e.tx_id, reconstructTxFromEventRow(e));
	}
	return [...byId.values()];
}

/**
 * The Index event_types the loader must fetch for a set of source filter types.
 * A contract_call/contract_deploy source matches a tx and hands its FULL event
 * set to the handler, so when one is present we fetch every classic event type
 * (the matched tx's events must be complete); otherwise just the referenced
 * types. VM types ride a second clock and are fetched only when referenced.
 * Shared by the subgraph loader and the chain-trigger evaluator.
 */
export function indexEventTypesForFilterTypes(filterTypes: string[]): string[] {
	const types = new Set<string>();
	if (filterTypes.some((t) => TX_SOURCE_TYPES.has(t))) {
		for (const t of CLASSIC_INDEX_EVENT_TYPES) types.add(t);
	}
	for (const t of filterTypes) {
		const indexType = EVENT_FILTER_TO_INDEX_TYPE[t];
		if (indexType) types.add(indexType);
	}
	return [...types];
}

/** Index event_types a subgraph's sources require. Empty when sources are absent. */
export function referencedIndexEventTypes(
	subgraph: SubgraphDefinition,
): string[] {
	if (!subgraph.sources) return [];
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

/** Merge of overlapping walks: one row per (type, height, event_index). */
function dedupeEvents(rows: IndexEventRow[]): IndexEventRow[] {
	const seen = new Set<string>();
	return rows.filter((e) => {
		const key = `${e.event_type}|${e.block_height}|${e.event_index}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Streams clock + Index data plane, reconstructed into raw BlockData rows. */
export class PublicApiBlockSource implements BlockSource {
	constructor(
		private readonly http: IndexHttpClient,
		private readonly eventTypes: string[],
		/** When set, enables the sparse-scan probe (event-scoped subgraphs). */
		private readonly probeTargets?: SparseProbeTarget[] | undefined,
		/** False for event-only subgraphs → skip walkTransactions, synthesize the
		 *  tx from joined event context. Defaults true (safe / unchanged). */
		private readonly needsTransactions = true,
		/** Write events from `state_writes` instead of the vm event walks. */
		private readonly feed?: StateWriteFeed | undefined,
	) {}

	/**
	 * What the event walks fetch. Event-only subgraphs walk exactly what their
	 * filters can match (contract-scoped where a filter pins one); tx-level
	 * sources need every event of a matched tx, so they walk each type whole.
	 */
	private walkTargets(): SparseProbeTarget[] {
		const scoped = this.needsTransactions ? undefined : this.probeTargets;
		// Under a state_writes feed, write events come from the writes walk.
		const types = this.feed
			? this.eventTypes.filter((t) => !VM_INDEX_EVENT_TYPES.has(t))
			: this.eventTypes;
		return types.flatMap((eventType) => {
			const own = scoped?.filter((t) => t.eventType === eventType);
			return own?.length ? own : [{ eventType }];
		});
	}

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

	getTip(opts?: { wait?: number; knownHeight?: number }): Promise<number> {
		// VM rows land with ingest. Decoded Index tip can lag; use the source
		// field when this loader fetches any vm type.
		if (this.eventTypes.some((t) => VM_INDEX_EVENT_TYPES.has(t))) {
			return this.http.getIndexSourceTip(opts);
		}
		// Scope the tip (and, with `wait`, what counts as "nothing new") to
		// exactly the classic types THIS source reads instead of the global
		// cross-decoder floor. Without this, any of the ~15 classic decoders
		// committing — most unrelated to what this source actually walks —
		// moves the global floor and makes an unrelated `wait` return early.
		return this.http.getIndexTip({ ...opts, eventTypes: this.eventTypes });
	}

	/** Reads the SAME envelope `getTip()` just cached on `this.http` — call
	 *  this only after `getTip()` has resolved at least once. */
	getDecodedHeights(): Record<string, number | null> | undefined {
		return this.http.getDecodedHeights();
	}

	async loadBlockRange(
		fromHeight: number,
		toHeight: number,
	): Promise<Map<number, BlockData>> {
		// Event-only subgraphs join tx context onto events (withTx) and skip the
		// walkTransactions over-fetch entirely; tx-level sources fetch real txs.
		const withTx = !this.needsTransactions;
		const [blocks, txRows, eventLists, writes] = await Promise.all([
			this.http.walkBlocks(fromHeight, toHeight),
			this.needsTransactions
				? this.http.walkTransactions(fromHeight, toHeight)
				: Promise.resolve<IndexTransactionRow[]>([]),
			Promise.all(
				this.walkTargets().map((t) =>
					this.http.walkEvents(
						t.eventType,
						fromHeight,
						toHeight,
						withTx,
						t.contractId,
					),
				),
			),
			this.feed ? this.walkWrites(fromHeight, toHeight, this.feed) : null,
		]);
		const events = dedupeEvents(eventLists.flat());

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
		// For event-only subgraphs, materialize only the event-bearing txs from
		// joined event context instead of every transaction in the range.
		const txs = this.needsTransactions
			? txRows.map(reconstructTransaction)
			: synthesizeTxsFromEvents(events);
		for (const t of txs) {
			map.get(t.block_height)?.txs.push(t);
		}
		for (const e of events) {
			const bd = map.get(e.block_height);
			if (!bd) continue;
			// vm rows ride their own clock: never merged into `events`, whose
			// order is classic event_index.
			if (VM_INDEX_EVENT_TYPES.has(e.event_type)) {
				bd.vmEvents ??= [];
				bd.vmEvents.push(reconstructEvent(e));
			} else {
				bd.events.push(reconstructEvent(e));
			}
		}
		if (writes) {
			for (const [height, fed] of writes) {
				const bd = map.get(height);
				if (!bd) continue;
				bd.txs.push(...fed.txs);
				bd.vmEvents = fed.vmEvents;
			}
		}
		// Canonical ordering — multi-type event walks merge here, per clock.
		for (const bd of map.values()) {
			bd.txs.sort((a, b) => (a.tx_index ?? 0) - (b.tx_index ?? 0));
			bd.events.sort((a, b) => a.event_index - b.event_index);
			bd.vmEvents?.sort((a, b) => a.event_index - b.event_index);
		}
		return map;
	}

	/** Each height's named writes as events, the writing txs rebuilt from the
	 *  joined `tx_*` fields. One walk per contract, merged in ordinal order. */
	private async walkWrites(
		fromHeight: number,
		toHeight: number,
		feed: StateWriteFeed,
	): Promise<ReturnType<typeof stateWriteBlocks>> {
		const walks = await Promise.all(
			(feed.contracts ?? [undefined]).map((c) =>
				this.http.walkStateWrites(fromHeight, toHeight, c),
			),
		);
		const writesByHeight = new Map<number, Map<number, StateWriteRow>>();
		const txsByHeight = new Map<number, Map<number, TxRecord>>();
		for (const row of walks.flat()) {
			const writes = writesByHeight.get(row.block_height) ?? new Map();
			writes.set(row.ordinal, row);
			writesByHeight.set(row.block_height, writes);
			const tx = writeTx(row);
			if (tx) {
				const txs = txsByHeight.get(row.block_height) ?? new Map();
				txs.set(row.tx_index as number, tx);
				txsByHeight.set(row.block_height, txs);
			}
		}
		return stateWriteBlocks(
			new Map(
				[...writesByHeight].map(([h, w]) => [
					h,
					[...w.values()].sort((a, b) => a.ordinal - b.ordinal),
				]),
			),
			new Map([...txsByHeight].map(([h, t]) => [h, [...t.values()]])),
		);
	}
}

/** The writing tx a `tx_context=true` row carries; null for block-level
 *  writes or a row whose tx the Index could not join. */
function writeTx(row: IndexStateWriteRow): TxRecord | null {
	if (row.tx_index === null || !row.tx_id) return null;
	return {
		tx_id: row.tx_id,
		tx_index: row.tx_index,
		type: row.tx_type ?? "",
		sender: row.tx_sender ?? "",
		status: row.tx_status ?? "",
		contract_id: row.tx_contract_id ?? null,
		function_name: row.tx_function_name ?? null,
	};
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
	/** True when the LAST `getTip()` call actually used the primary — guards
	 *  `getDecodedHeights()` against returning the primary's stale cached
	 *  envelope from an earlier success after a call that just fell back. */
	private lastTipFromPrimary = false;

	constructor(
		private readonly primary: BlockSource,
		private readonly fallback: BlockSource,
	) {}

	async getTip(opts?: {
		wait?: number;
		knownHeight?: number;
	}): Promise<number> {
		try {
			const tip = await this.primary.getTip(opts);
			this.lastTipFromPrimary = true;
			return tip;
		} catch (err) {
			// A billing refusal is not the api being down: the DB tap would
			// quietly serve different data, so let the caller pause instead.
			if (err instanceof BillingPausedError) throw err;
			logger.warn("block source primary getTip failed — using DB tap", {
				error: err instanceof Error ? err.message : String(err),
			});
			this.lastTipFromPrimary = false;
			// The DB tap has no wait/long-poll notion — a plain read is already
			// instant, so `opts` is dropped here rather than forwarded.
			return this.fallback.getTip();
		}
	}

	/** Only meaningful right after a `getTip()` that used the primary — the
	 *  fallback (Postgres tap) has no such notion, and returning the
	 *  primary's stale cache after a fallback would mismatch the returned
	 *  tip. Local mode's own `decoderBoundTip` never calls this. */
	getDecodedHeights(): Record<string, number | null> | undefined {
		if (!this.lastTipFromPrimary) return undefined;
		return this.primary.getDecodedHeights?.();
	}

	async loadBlockRange(
		fromHeight: number,
		toHeight: number,
	): Promise<Map<number, BlockData>> {
		try {
			return await this.primary.loadBlockRange(fromHeight, toHeight);
		} catch (err) {
			if (err instanceof BillingPausedError) throw err;
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

/** The Postgres tap for a subgraph: its `state_writes` feed when it has one. */
function postgresSourceFor(feed: StateWriteFeed | null): BlockSource {
	return feed ? new PostgresBlockSource(feed) : postgresBlockSource;
}

/**
 * HTTP (Streams+Index) chain source for a set of decoded event types, wrapped so
 * it falls back to the Postgres tap when api is down. Used by the chain-trigger
 * evaluator (which isn't subgraph-scoped, so it can't go through resolveBlockSource).
 *
 * `needsTransactions` defaults true (safe/unchanged) but the evaluator passes
 * `chainSubsNeedTransactions(chainSubs)` so a tick with no contract_call/deploy
 * trigger skips `walkTransactions` entirely — one fewer HTTP round trip and a
 * smaller `walkEvents` payload (no `tx_context` join) on every such tick.
 *
 * `httpClient` defaults to a fresh client (unchanged behavior) — pass one in
 * to reuse across calls. The evaluator's own long-lived loop does this so
 * `IndexHttpClient.waitIsSupported()` reflects what THIS
 * server actually supports instead of resetting every tick.
 */
export function buildChainBlockSource(
	eventTypes: string[],
	needsTransactions = true,
	httpClient: IndexHttpClient = buildHttpClient(),
): BlockSource {
	return new FallbackBlockSource(
		new PublicApiBlockSource(
			httpClient,
			eventTypes,
			undefined,
			needsTransactions,
		),
		postgresBlockSource,
	);
}

export function buildHttpClient(): IndexHttpClient {
	return createInternalIndexHttpClient();
}

/**
 * Resolve the block source for a subgraph. `SUBGRAPH_SOURCE=streams-index`
 * opts eligible subgraphs onto the public Streams clock + Index data;
 * `SUBGRAPH_SOURCE=observer-http` pages internal observer-events (experimental).
 * Default stays on the Postgres tap.
 */
export async function resolveBlockSource(
	subgraph?: SubgraphDefinition,
): Promise<BlockSource> {
	if (process.env.SUBGRAPH_SOURCE === "observer-http") {
		const baseUrl = process.env.OBSERVER_HTTP_URL;
		if (!baseUrl) {
			throw new Error(
				"SUBGRAPH_SOURCE=observer-http requires OBSERVER_HTTP_URL",
			);
		}
		return new ObserverHttpBlockSource({
			baseUrl,
			token: process.env.OBSERVER_HTTP_EXPORT_TOKEN || null,
		});
	}
	if (
		process.env.SUBGRAPH_SOURCE === "streams-index" &&
		subgraph &&
		isStreamsIndexEligible(subgraph)
	) {
		// Soft-depend on api: fall back to the Postgres tap per-call if the HTTP
		// plane is down, so the processor keeps advancing instead of stalling.
		// Both read the same feed, decided by the plane this source reads.
		const feed =
			(await stateWriteFeed(subgraph, httpStateWritesCoverage())) ?? undefined;
		return new FallbackBlockSource(
			new PublicApiBlockSource(
				buildHttpClient(),
				referencedIndexEventTypes(subgraph),
				// The sparse probe reads vm_events; a state_writes feed walks
				// every block instead of skipping on another table's rows.
				canSparseScan(subgraph) && !feed
					? sparseProbeTargets(subgraph)
					: undefined,
				needsTransactionData(subgraph),
				feed,
			),
			postgresSourceFor(feed ?? null),
		);
	}
	if (process.env.SUBGRAPH_SOURCE === "streams-index" && subgraph) {
		logger.debug("Subgraph not streams-index eligible, using DB tap", {
			subgraph: subgraph.name,
		});
	}
	return postgresSourceFor(await stateWriteFeed(subgraph));
}
