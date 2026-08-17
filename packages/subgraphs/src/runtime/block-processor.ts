import { type Database, getTargetDb } from "@secondlayer/shared/db";
import { resolveTraitContractIds } from "@secondlayer/shared/db/queries/contracts";
import { recordGapBatch } from "@secondlayer/shared/db/queries/subgraph-gaps";
import { advanceOperationCursor } from "@secondlayer/shared/db/queries/subgraph-operations";
import {
	recordLiveError,
	recordLiveProgress,
	recordSubgraphProcessed,
	rewindLiveProgress,
	updateSubgraphStatus,
} from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import { type Kysely, type Transaction, sql } from "kysely";
import { pgSchemaName } from "../schema/utils.ts";
import type { SubgraphDefinition } from "../types.ts";
import { resolveBlockSource } from "./block-source.ts";
import {
	type BlockMeta,
	JOURNAL_RETENTION_BLOCKS,
	SubgraphContext,
	type TxMeta,
} from "./context.ts";
import { emitSubscriptionOutbox } from "./outbox-emit.ts";
import { buildEventPayload, runHandlers } from "./runner.ts";
import { sandboxEnabled } from "./sandbox/flag.ts";
import { evictSandboxWorker, runHandlersSandboxed } from "./sandbox/host.ts";
import {
	type EventRecord,
	type TxRecord,
	matchSources,
	readPath,
} from "./source-matcher.ts";
import { matcher } from "./subscription-state.ts";

/**
 * The data-plane route for a subgraph: which schema its tables live in and the
 * managed target DB the writes/reads land on. Cached per subgraph to avoid a
 * per-block lookup; invalidated on redeploy via
 * {@link invalidateSubgraphRoute}.
 *
 * Also carries the f071 Stage A sandbox-dispatch inputs
 * (`sandboxWorkers`/`handlerCode`/`version`) — cheap to keep alongside the
 * route since `resolveRoute` already selects the full `subgraphs` row; kept
 * in lockstep with the same cache invalidation edge (redeploys change
 * `handler_code`/`version` together).
 */
interface SubgraphRoute {
	schemaName: string;
	dataDb: Kysely<Database>;
	/** `subgraphs.sandbox_workers` — combined with the global env gate by
	 *  `sandboxEnabled()`. Default false for every row; nothing in committed
	 *  code sets it true (f071 Stage A stays dark). */
	sandboxWorkers: boolean;
	handlerCode: string | null;
	version: string;
}
const routeCache = new Map<string, SubgraphRoute>();

async function resolveRoute(
	subgraphName: string,
	targetDb: Kysely<Database>,
): Promise<SubgraphRoute> {
	const cached = routeCache.get(subgraphName);
	if (cached) return cached;
	const row = await targetDb
		.selectFrom("subgraphs")
		.selectAll()
		.where("name", "=", subgraphName)
		.executeTakeFirst();
	const route: SubgraphRoute = {
		schemaName: row?.schema_name ?? pgSchemaName(subgraphName),
		dataDb: targetDb,
		sandboxWorkers: row?.sandbox_workers === true,
		handlerCode: row?.handler_code ?? null,
		version: row?.version ?? "",
	};
	routeCache.set(subgraphName, route);
	// f071 Stage A observability: state which handler-execution path this
	// subgraph resolved to, once per route-cache resolution (process start,
	// or the next block after a redeploy invalidates the cache) — never per
	// block, so this can't spam logs. Doesn't change dispatch: reads the same
	// `sandboxEnabled` inputs the ternary at the call site below uses.
	logger.info("subgraph handler dispatch path resolved", {
		subgraph: subgraphName,
		path: sandboxEnabled({ sandbox_workers: route.sandboxWorkers })
			? "sandbox"
			: "in-process",
	});
	return route;
}

/** Drop a subgraph's cached route — call on redeploy/delete (conn may
 *  change). Also evicts any warm sandbox subprocess for this subgraph
 *  (f071 Stage A `host.ts`) on the same edge: a redeploy can change
 *  `handler_code`/`version` together, and a stale warm
 *  subprocess must not survive past this invalidation any more than the
 *  cached route does. A no-op today since nothing sets `sandbox_workers`,
 *  but keeps the pool's documented invalidation contract honest for when it
 *  is. */
export function invalidateSubgraphRoute(subgraphName: string): void {
	routeCache.delete(subgraphName);
	evictSandboxWorker(subgraphName);
}

/**
 * Resolve each distinct trait used by a subgraph's sources to its conforming
 * contract-id set, as of `blockHeight`, from the contract registry. Empty map
 * when no source is trait-scoped (the common case → no DB work).
 */
/**
 * Resolve each factory-scoped source's address set for this block.
 *
 * Two parts, and the ORDER is the guarantee:
 * 1. addresses persisted by earlier blocks (`block_height <= blockHeight`,
 *    so a reindex sees exactly what the live walk saw), then
 * 2. addresses revealed by THIS block's events — computed before matching,
 *    so a contract discovered in block N receives its own block-N events.
 *    Without this pass the first event from every discovered contract is
 *    silently lost.
 */
/**
 * Exported as a test seam. Both guarantees this function carries — a contract
 * discovered in block N receiving its OWN block-N events, and the persisted set
 * being height-stamped so a reorg can roll it back — were asserted only by
 * comment until now.
 */
export async function resolveFactoryContracts(
	subgraph: SubgraphDefinition,
	blockHeight: number,
	schemaName: string,
	db: Kysely<Database>,
	txs: TxRecord[],
	evts: EventRecord[],
): Promise<{
	resolved: Map<string, ReadonlySet<string>>;
	discovered: Array<{ sourceName: string; address: string }>;
}> {
	// Keyed by the DISCOVERING source (`factory.from`), not the consuming one:
	// several sources can share one factory, and this way the extraction runs
	// once per discovering source rather than once per consumer.
	const factories = new Map<string, { from: string; field: string }>();
	for (const source of Object.values(subgraph.sources)) {
		const factory = (source as { factory?: { from: string; field: string } })
			.factory;
		if (factory) factories.set(factory.from, factory);
	}
	const resolved = new Map<string, ReadonlySet<string>>();
	const discovered: Array<{ sourceName: string; address: string }> = [];
	if (factories.size === 0) return { resolved, discovered };

	for (const [discoveringSource, factory] of factories) {
		const known = new Set<string>();
		// 1. Everything revealed at or below this height.
		try {
			const rows = await sql<{ address: string }>`
				SELECT address FROM ${sql.raw(`"${schemaName}"."_factory_addresses"`)}
				WHERE source_name = ${discoveringSource} AND block_height <= ${blockHeight}
			`.execute(db);
			for (const row of rows.rows) known.add(row.address);
		} catch {
			// Table absent (first deploy before DDL, or a non-factory subgraph):
			// treat as an empty set rather than failing the block.
		}

		// 2. This block's own reveals — before matching, so same-block events
		//    from a new contract are not dropped.
		const discovering = subgraph.sources[factory.from];
		if (discovering) {
			const matches = matchSources(
				{ [factory.from]: discovering },
				txs,
				evts,
				new Map(),
				new Map(),
			);
			for (const match of matches) {
				for (const event of match.events ?? []) {
					const payload = buildEventPayload(discovering, match.tx, event);
					const value = readPath(payload, factory.field);
					if (
						typeof value === "string" &&
						value.length > 0 &&
						!known.has(value)
					) {
						known.add(value);
						discovered.push({ sourceName: discoveringSource, address: value });
					}
				}
			}
		}
		resolved.set(discoveringSource, known);
	}
	return { resolved, discovered };
}

/** Persist this block's discoveries, stamped with the block that revealed
 *  them so the reorg handler can roll them back. */
async function persistFactoryDiscoveries(
	schemaName: string,
	db: Kysely<Database>,
	blockHeight: number,
	discovered: Array<{ sourceName: string; address: string }>,
): Promise<void> {
	if (discovered.length === 0) return;
	for (const { sourceName, address } of discovered) {
		await sql`
			INSERT INTO ${sql.raw(`"${schemaName}"."_factory_addresses"`)}
				(source_name, address, block_height)
			VALUES (${sourceName}, ${address}, ${blockHeight})
			ON CONFLICT (source_name, address) DO NOTHING
		`.execute(db);
	}
}

async function resolveTraitContracts(
	subgraph: SubgraphDefinition,
	blockHeight: number,
	db: Kysely<Database>,
): Promise<Map<string, ReadonlySet<string>>> {
	const traits = new Set<string>();
	for (const source of Object.values(subgraph.sources)) {
		const trait = (source as { trait?: string }).trait;
		if (trait) traits.add(trait);
	}
	const resolved = new Map<string, ReadonlySet<string>>();
	for (const trait of traits) {
		const ids = await resolveTraitContractIds(db, trait, blockHeight);
		resolved.set(trait, new Set(ids));
	}
	return resolved;
}

export interface ProcessBlockTiming {
	totalMs: number;
	handlerMs: number;
	flushMs: number;
}

export interface ProcessBlockResult {
	blockHeight: number;
	matched: number;
	processed: number;
	errors: number;
	skipped: boolean;
	timing?: ProcessBlockTiming;
}

/**
 * Process a single block through a single subgraph's pipeline.
 *
 * Flow:
 * 1. Load block + txs + events from DB
 * 2. Run source matcher
 * 3. Run handlers with SubgraphContext
 * 4. Flush context (commit writes atomically)
 * 5. Update subgraph.last_processed_block
 */
export interface PreloadedBlockData {
	block: import("@secondlayer/shared/db").Block;
	txs: import("@secondlayer/shared/db").Transaction[];
	events: import("@secondlayer/shared/db").Event[];
}

export interface ProcessBlockOptions {
	/** Skip updating last_processed_block in DB (reindex batches this externally). */
	skipProgressUpdate?: boolean;
	/** Pre-loaded block data — skips DB reads when provided (used by batch catch-up). */
	preloaded?: PreloadedBlockData;
	/**
	 * Crash-safe sequential processing. Two checkpoint scopes:
	 * - `{ status }` (reindex): a written block commits
	 *   `subgraphs.last_processed_block = blockHeight` in the SAME transaction
	 *   as its writes; replays skip at/below the cursor. Only for strictly
	 *   ascending walks over the subgraph's own cursor.
	 * - `{ operationId }` (backfill): same guarantee against the OPERATION's
	 *   own `cursor_block` — backfills legitimately revisit heights below the
	 *   live cursor, so they must never checkpoint (or read) the subgraph
	 *   cursor. The advance is a CONDITIONAL monotonic UPDATE: concurrent
	 *   writers serialize on it, and the loser's whole block tx rolls back
	 *   (surfaced as `skipped`, never an error/gap).
	 * Either way: a crash can never leave committed deltas ahead of the
	 * relevant checkpoint.
	 */
	atomicProgress?: { status: string } | { operationId: string };
	/**
	 * Reorg rewind (f069): set exclusively by `reorg.ts`'s fork-block
	 * reprocess. Bypasses the live-path replay guard (a fork block's height
	 * is, by construction, at or below the current cursor — the guard would
	 * otherwise skip it) and writes the checkpoint via
	 * `rewindLiveProgress` (unconditional — a rewind's whole point is
	 * moving the cursor *backward*, which the live path's conditional
	 * advance would refuse). Safe only because the reorg path holds a
	 * transaction-scoped advisory lock across its whole
	 * delete+reprocess+rewind sequence, so nothing else can interleave a
	 * forward write. Never set this outside `reorg.ts`.
	 */
	reorgRewind?: true;
	/** The subgraph row's uuid. Required to record a gap row when a block
	 *  processes with handler errors — `subgraph_gaps.subgraph_id` is NOT NULL.
	 *  Absent on paths that pass `skipProgressUpdate` (they record gaps
	 *  themselves, see reindex.ts). */
	subgraphId?: string;
}

/** Thrown inside the block tx when a racing writer already covered this
 *  height — rolls the tx back; processBlock converts it to `skipped`. The
 *  winner committed the block, so this is success-shaped, never a gap. */
class CursorRaceLostError extends Error {
	constructor(operationId: string, height: number) {
		super(`op ${operationId} lost cursor race at block ${height}`);
		this.name = "CursorRaceLostError";
	}
}

/** Live-path sibling of {@link CursorRaceLostError}: thrown when the live
 *  path's conditional `recordLiveProgress` advance loses to a racing
 *  writer that already committed a higher (or equal) `last_processed_block`
 *  for this subgraph. Same success-shaped handling — the winner's commit
 *  stands, so this becomes `result.skipped = true`, never an error/gap. */
class LiveCursorRaceLostError extends Error {
	constructor(subgraphName: string, height: number) {
		super(`live cursor race lost for ${subgraphName} at block ${height}`);
		this.name = "LiveCursorRaceLostError";
	}
}

function opCursorMode(
	opts?: ProcessBlockOptions,
): { operationId: string } | undefined {
	const ap = opts?.atomicProgress;
	return ap && "operationId" in ap ? ap : undefined;
}

/** True only for the reorg fork-block reprocess — see `reorgRewind` on
 *  {@link ProcessBlockOptions}. */
function isReorgRewind(opts?: ProcessBlockOptions): boolean {
	return opts?.reorgRewind === true;
}

function statusMode(
	opts?: ProcessBlockOptions,
): { status: string } | undefined {
	const ap = opts?.atomicProgress;
	return ap && "status" in ap ? ap : undefined;
}

/** Default per-block retry schedule before a failure counts as persistent. */
export const BLOCK_RETRY_DELAYS_MS: number[] = [500, 2_000, 5_000];

/**
 * Journal pre-images on the live path only. Deep reindex/backfill heights
 * (skipProgressUpdate) are past finality — a reorg can't reach them, so
 * journaling would be pure churn for the pruner.
 */
function journalEnabled(opts?: ProcessBlockOptions): boolean {
	return !opts?.skipProgressUpdate;
}

/**
 * processBlock with bounded retries. Throws the last error once the schedule
 * is exhausted — callers decide whether that halts the walk (strict paths) or
 * records a gap (backfill). Never advances any cursor on failure.
 */
export async function processBlockWithRetry(
	subgraph: SubgraphDefinition,
	subgraphName: string,
	blockHeight: number,
	opts?: ProcessBlockOptions,
	retryDelaysMs: number[] = BLOCK_RETRY_DELAYS_MS,
): Promise<ProcessBlockResult> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
		try {
			return await processBlock(subgraph, subgraphName, blockHeight, opts);
		} catch (err) {
			lastError = err;
			const delay = retryDelaysMs[attempt];
			if (delay === undefined) break;
			logger.warn("Block processing failed, retrying", {
				subgraph: subgraphName,
				blockHeight,
				attempt: attempt + 1,
				retryInMs: delay,
				error: err instanceof Error ? err.message : String(err),
			});
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	throw lastError;
}

export async function processBlock(
	subgraph: SubgraphDefinition,
	subgraphName: string,
	blockHeight: number,
	opts?: ProcessBlockOptions,
): Promise<ProcessBlockResult> {
	const targetDb = getTargetDb();
	const blockStart = performance.now();
	const result: ProcessBlockResult = {
		blockHeight,
		matched: 0,
		processed: 0,
		errors: 0,
		skipped: false,
	};

	// 1. Load block from source DB (shared indexer) — use pre-loaded data if available
	let block: PreloadedBlockData["block"] | undefined;
	let txs: PreloadedBlockData["txs"];
	let evts: PreloadedBlockData["events"];
	if (opts?.preloaded) {
		block = opts.preloaded.block;
		txs = opts.preloaded.txs;
		evts = opts.preloaded.events;
	} else {
		// The block source returns canonical blocks only, so a missing entry
		// means the block is absent or non-canonical — skip either way.
		const data = (
			await resolveBlockSource(subgraph).loadBlockRange(
				blockHeight,
				blockHeight,
			)
		).get(blockHeight);
		if (!data) {
			logger.debug("Block not found or non-canonical for subgraph processing", {
				subgraph: subgraphName,
				blockHeight,
			});
			result.skipped = true;
			return result;
		}
		block = data.block;
		txs = data.txs;
		evts = data.events;
	}

	// 3. Match source. Trait-scoped sources ({ trait: "sip-010" }) resolve to the
	// set of conforming contracts AS OF this block (deploy_height ≤ blockHeight),
	// so a reindex backfills a token's full history even if it was classified
	// after deploy. Resolution is done here (DB access) so the matcher stays pure.
	// Route first: the factory set lives in this subgraph's pg schema, and it
	// must resolve BEFORE matching. `resolveRoute` is cached per subgraph.
	const route = await resolveRoute(subgraphName, targetDb);
	const schemaName = route.schemaName;

	const traitContracts = await resolveTraitContracts(
		subgraph,
		blockHeight,
		targetDb,
	);
	// Factory sets resolve BEFORE matching so a contract revealed in this
	// block receives its own block-N events (see resolveFactoryContracts).
	const { resolved: factoryContracts, discovered } =
		await resolveFactoryContracts(
			subgraph,
			blockHeight,
			schemaName,
			targetDb,
			txs,
			evts,
		);
	const matched = matchSources(
		subgraph.sources,
		txs,
		evts,
		traitContracts,
		factoryContracts,
	);
	result.matched = matched.length;

	if (matched.length === 0) {
		if (!opts?.skipProgressUpdate) {
			if (isReorgRewind(opts)) {
				// Fork block itself may match nothing for this subgraph — the
				// rewind still must land (unconditional, may move backward).
				await rewindLiveProgress(targetDb, subgraphName, blockHeight);
			} else {
				// Promote-but-never-unpark: unconditional "active" stamping let the
				// live walk overwrite "reindexing" set by a queued reindex op,
				// flapping the subgraph back into catch-up (and into collision with
				// the op's schema drop). Conditional advance (f069): a no-write
				// block can't race-lose in any way that matters (nothing was
				// written), so a `false` return here is a silent no-op — the
				// cursor simply stays at whatever a racing writer already set it
				// to.
				await recordLiveProgress(targetDb, subgraphName, blockHeight);
			}
		}
		return result;
	}

	// 4. Data plane (managed target DB) — resolved above, since factory-set
	// resolution needs the schema name.
	const blockMeta: BlockMeta = {
		height: block.height,
		hash: block.hash,
		timestamp: block.timestamp,
		burnBlockHeight: block.burn_block_height,
		indexBlockHash: block.index_block_hash,
	};
	const initialTx: TxMeta = {
		txId: "",
		sender: "",
		type: "",
		status: "",
	};

	let handlerMs = 0;
	let flushMs = 0;

	// Progress + health writes — always on the managed DB, identical in both
	// modes (the subgraphs control-plane table lives in target). Only ever
	// reached with real work to do on the live catch-up path and the reorg
	// rewind path (both leave `skipProgressUpdate` unset); reindex/backfill
	// always pass `skipProgressUpdate: true` and return above.
	const applyProgress = async (
		tx: Transaction<Database>,
		rr: { processed: number; errors: number },
		flushedWrites: boolean,
	) => {
		if (opts?.skipProgressUpdate) return;
		const rewind = isReorgRewind(opts);
		if (rr.errors > 0 && rr.processed === 0) {
			if (rewind) {
				await updateSubgraphStatus(tx, subgraphName, "error", blockHeight);
			} else {
				// f069: conditional — see recordLiveError's docblock for why a lost
				// race here is always a silent no-op (an all-failed block never
				// flushes writes, so there's nothing to protect by throwing).
				await recordLiveError(tx, subgraphName, blockHeight);
			}
		} else if (rewind) {
			// Unconditional, may move the cursor backward — see ProcessBlockOptions.
			await rewindLiveProgress(tx, subgraphName, blockHeight);
		} else {
			// Promote-but-never-unpark (see matched-0 note). Conditional advance
			// (f069): a racing writer that already committed a higher cursor for
			// this height means OUR writes must not stand — abort the whole tx
			// so ctx.increment deltas already flushed above roll back with it.
			const advanced = await recordLiveProgress(tx, subgraphName, blockHeight);
			if (!advanced && flushedWrites) {
				throw new LiveCursorRaceLostError(subgraphName, blockHeight);
			}
		}
		// A handler that threw had its writes rolled back (runner.ts
		// ctx.rollbackTo) but the cursor still advances, so those events are
		// gone unless something records where. Gap rows are what `/gaps` and
		// backfill repair from — the reindex path has always written them
		// (reindex.ts), the live path never did.
		if (rr.errors > 0 && !rewind) {
			if (opts?.subgraphId) {
				await recordGapBatch(tx, opts.subgraphId, subgraphName, [
					{ start: blockHeight, end: blockHeight, reason: "processing_error" },
				]);
			} else {
				logger.warn("Block errors not recorded as a gap — no subgraphId", {
					subgraph: subgraphName,
					blockHeight,
					errors: rr.errors,
				});
			}
		}
		if (rr.processed > 0 || rr.errors > 0) {
			const lastError =
				rr.errors > 0
					? `${rr.errors} error(s) at block ${blockHeight}`
					: undefined;
			await recordSubgraphProcessed(
				tx,
				subgraphName,
				rr.processed,
				rr.errors,
				lastError,
			);
		}
	};

	// Managed: a single atomic transaction on the target DB.
	try {
		await targetDb.transaction().execute(async (tx: Transaction<Database>) => {
			// Replay guard (sequential walks only): committed writes always carry
			// their checkpoint (below), so a block at/below the cursor has already
			// been applied — running it again would double-apply deltas.
			const opMode = opCursorMode(opts);
			const sm = statusMode(opts);
			const rewind = isReorgRewind(opts);
			if (sm) {
				const row = await tx
					.selectFrom("subgraphs")
					.select("last_processed_block")
					.where("name", "=", subgraphName)
					.executeTakeFirst();
				if (row && Number(row.last_processed_block) >= blockHeight) {
					result.skipped = true;
					return;
				}
			} else if (opMode) {
				// Fast path only — the conditional advance below is the guarantee.
				const row = await tx
					.selectFrom("subgraph_operations")
					.select("cursor_block")
					.where("id", "=", opMode.operationId)
					.executeTakeFirst();
				if (
					row?.cursor_block != null &&
					Number(row.cursor_block) >= blockHeight
				) {
					result.skipped = true;
					return;
				}
			} else if (!rewind) {
				// f069: the same fast-path guard, now armed on the live path.
				// Fast path only — the conditional `recordLiveProgress` advance
				// below (via applyProgress) is the actual guarantee; this SELECT,
				// taken before handlers run, cannot see a same-height race that
				// commits between here and there. Never checked when `rewind` is
				// set: a reorg's fork block is, by construction, at or below the
				// current cursor, and must run anyway.
				const row = await tx
					.selectFrom("subgraphs")
					.select("last_processed_block")
					.where("name", "=", subgraphName)
					.executeTakeFirst();
				if (row && Number(row.last_processed_block) >= blockHeight) {
					result.skipped = true;
					return;
				}
			}

			const ctx = new SubgraphContext(
				tx,
				schemaName,
				subgraph.schema,
				blockMeta,
				initialTx,
				journalEnabled(opts),
			);

			// f071 Stage A: dark, flag-gated dispatch. `sandboxEnabled` requires
			// BOTH the global env gate AND this subgraph's `sandbox_workers`
			// column — nothing in committed code sets that column, so this
			// branch is unreached in production today; `runHandlers` (below)
			// is what actually executes, byte-identical to before this plan.
			// When it IS reached: `runHandlersSandboxed` runs handlers in the
			// sandbox subprocess but replays their decided ops onto THIS same
			// `ctx`, bound to THIS same open transaction, before returning —
			// so the flush/manifest/outbox flow and the f069 guard placement
			// below are unaffected either way (see `host.ts`'s docblock).
			const handlerStart = performance.now();
			const runResult = sandboxEnabled({
				sandbox_workers: route.sandboxWorkers,
			})
				? await runHandlersSandboxed({
						subgraphName,
						version: route.version,
						handlerCode: route.handlerCode,
						hostCtx: ctx,
						block: blockMeta,
						matched,
					})
				: await runHandlers(subgraph, matched, ctx);
			handlerMs = performance.now() - handlerStart;

			result.processed = runResult.processed;
			result.errors = runResult.errors;

			let flushedWrites = false;
			if (ctx.pendingOps > 0) {
				const flushStart = performance.now();
				const manifest = await ctx.flush();
				flushedWrites = manifest.count > 0;
				if (manifest.count > 0) {
					await emitSubscriptionOutbox(
						tx,
						subgraphName,
						manifest,
						matcher,
						block.height,
					);
				}
				flushMs = performance.now() - flushStart;
			}

			// Checkpoint travels with the writes it covers — a crash can never
			// leave committed deltas ahead of the checkpoint (fix-f040 B3).
			if (sm && flushedWrites) {
				await updateSubgraphStatus(tx, subgraphName, sm.status, blockHeight);
			} else if (opMode && flushedWrites) {
				const advanced = await advanceOperationCursor(
					tx,
					opMode.operationId,
					blockHeight,
				);
				if (!advanced) {
					// A racing writer (zombie/claimer) already covered this height —
					// abort OUR writes; the winner's commit stands.
					throw new CursorRaceLostError(opMode.operationId, blockHeight);
				}
			}

			await applyProgress(tx, runResult, flushedWrites);
		});
	} catch (err) {
		if (
			err instanceof CursorRaceLostError ||
			err instanceof LiveCursorRaceLostError
		) {
			// Success-shaped: the block IS committed (by the winner). Surfacing
			// this as an error would mint a false gap row and re-invite the
			// double-apply through gap repair.
			logger.warn("cursor race lost — block already covered", {
				subgraph: subgraphName,
				blockHeight,
				error: err.message,
			});
			result.skipped = true;
			return result;
		}
		throw err;
	}

	// Persist factory discoveries only after the block's writes commit, so a
	// failed block doesn't leave addresses claimed for a block that produced
	// nothing. Stamped with this height, so the reorg handler rolls them back
	// with everything else. Idempotent (ON CONFLICT DO NOTHING), so a
	// guard-skipped block replaying here is harmless.
	if (!result.skipped) {
		await persistFactoryDiscoveries(
			schemaName,
			route.dataDb,
			blockHeight,
			discovered,
		);
	}

	const totalMs = performance.now() - blockStart;
	// f069: a skipped block (guard fast-path, or a race-loss success-shaped
	// skip) never reaches here as a distinct branch — it falls through from
	// the transaction callback's early `return`. `blocks_processed` is now
	// load-bearing forensic evidence (f068's own re-derivation of it), so a
	// skip must not inflate it: only count blocks that actually ran handlers.
	if (!result.skipped) {
		result.timing = {
			totalMs: Math.round(totalMs),
			handlerMs: Math.round(handlerMs),
			flushMs: Math.round(flushMs),
		};
	}

	// 7. Row count warning — sample every 1000 blocks (uses pg_stat estimate, not COUNT(*))
	if (blockHeight % 1000 === 0) {
		try {
			const tables = Object.keys(subgraph.schema);
			for (const table of tables) {
				const { rows } = await sql
					.raw(
						`SELECT n_live_tup AS count FROM pg_stat_user_tables WHERE schemaname = '${schemaName}' AND relname = '${table}'`,
					)
					.execute(route.dataDb);
				const count = Number((rows[0] as Record<string, unknown>)?.count ?? 0);
				if (count >= 10_000_000) {
					logger.warn("Subgraph table exceeds 10M rows (estimate)", {
						subgraph: subgraphName,
						table,
						count,
					});
				}
			}
		} catch (err) {
			// Expected: table may not exist yet (fresh subgraph, first few
			// blocks before DDL runs). Log at debug so real errors —
			// connection, permissions, query plan — aren't invisible.
			logger.debug("Row count sample failed", {
				subgraph: subgraphName,
				error: err instanceof Error ? err.message : String(err),
			});
		}

		// Prune reorg-journal entries past finality (fix-f040 B2). Same cadence
		// as the row sample; retention is generous vs observed reorg depth.
		if (journalEnabled(opts)) {
			await sql
				.raw(
					`DELETE FROM "${schemaName}"."_journal" WHERE "block_height" < ${blockHeight - JOURNAL_RETENTION_BLOCKS}`,
				)
				.execute(route.dataDb)
				.catch(() => {
					// Journal may not exist yet (pre-journal deploy, no writes since).
				});
		}
	}

	return result;
}
