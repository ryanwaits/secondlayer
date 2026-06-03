import { type Database, getTargetDb } from "@secondlayer/shared/db";
import { resolveTraitContractIds } from "@secondlayer/shared/db/queries/contracts";
import {
	isByoSubgraph,
	recordSubgraphProcessed,
	resolveSubgraphDb,
	updateSubgraphStatus,
} from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import { type Kysely, type Transaction, sql } from "kysely";
import { pgSchemaName } from "../schema/utils.ts";
import type { SubgraphDefinition } from "../types.ts";
import { resolveBlockSource } from "./block-source.ts";
import { type BlockMeta, SubgraphContext, type TxMeta } from "./context.ts";
import { emitSubscriptionOutbox } from "./outbox-emit.ts";
import { runHandlers } from "./runner.ts";
import { matchSources } from "./source-matcher.ts";
import { matcher } from "./subscription-state.ts";

/**
 * The data-plane route for a subgraph: which schema its tables live in, the DB
 * those writes/reads land on (the user's DB when BYO, else the managed target),
 * and whether it's BYO. Cached per subgraph to avoid a per-block lookup +
 * decrypt; invalidated on redeploy (the connection can change) via
 * {@link invalidateSubgraphRoute}.
 */
interface SubgraphRoute {
	schemaName: string;
	dataDb: Kysely<Database>;
	byo: boolean;
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
	const byo = row ? isByoSubgraph(row) : false;
	const route: SubgraphRoute = {
		schemaName: row?.schema_name ?? pgSchemaName(subgraphName),
		dataDb: row && byo ? resolveSubgraphDb(row) : targetDb,
		byo,
	};
	routeCache.set(subgraphName, route);
	return route;
}

/** Drop a subgraph's cached route — call on redeploy/delete (conn may change). */
export function invalidateSubgraphRoute(subgraphName: string): void {
	routeCache.delete(subgraphName);
}

/**
 * Resolve each distinct trait used by a subgraph's sources to its conforming
 * contract-id set, as of `blockHeight`, from the contract registry. Empty map
 * when no source is trait-scoped (the common case → no DB work).
 */
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
	const traitContracts = await resolveTraitContracts(
		subgraph,
		blockHeight,
		targetDb,
	);
	const matched = matchSources(subgraph.sources, txs, evts, traitContracts);
	result.matched = matched.length;

	if (matched.length === 0) {
		if (!opts?.skipProgressUpdate) {
			await updateSubgraphStatus(targetDb, subgraphName, "active", blockHeight);
		}
		return result;
	}

	// 4. Resolve where this subgraph's data plane lives (managed target DB, or
	// the user's DB when BYO). Cached per subgraph.
	const route = await resolveRoute(subgraphName, targetDb);
	const schemaName = route.schemaName;
	const blockMeta: BlockMeta = {
		height: block.height,
		hash: block.hash,
		timestamp: block.timestamp,
		burnBlockHeight: block.burn_block_height,
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
	// modes (the subgraphs control-plane table lives in target).
	const applyProgress = async (
		tx: Transaction<Database>,
		rr: { processed: number; errors: number },
	) => {
		if (opts?.skipProgressUpdate) return;
		const status = rr.errors > 0 && rr.processed === 0 ? "error" : "active";
		await updateSubgraphStatus(tx, subgraphName, status, blockHeight);
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

	if (route.byo) {
		// BYO: no cross-DB transaction possible. Phase A commits handler writes to
		// the user DB first (replace-per-height makes a replay idempotent); phase
		// B then records outbox + progress on the managed DB. If phase A throws,
		// progress never advances and the block replays — safe by construction.
		let runResult = { processed: 0, errors: 0 };
		let manifest: Awaited<ReturnType<SubgraphContext["flush"]>> | undefined;
		await route.dataDb
			.transaction()
			.execute(async (tx: Transaction<Database>) => {
				const ctx = new SubgraphContext(
					tx,
					schemaName,
					subgraph.schema,
					blockMeta,
					initialTx,
					true,
				);
				const handlerStart = performance.now();
				runResult = await runHandlers(subgraph, matched, ctx);
				handlerMs = performance.now() - handlerStart;
				if (ctx.pendingOps > 0) {
					const flushStart = performance.now();
					manifest = await ctx.flush();
					flushMs = performance.now() - flushStart;
				}
			});
		result.processed = runResult.processed;
		result.errors = runResult.errors;

		// Phase B (managed) — only reached after phase A commits.
		await targetDb.transaction().execute(async (tx: Transaction<Database>) => {
			if (manifest && manifest.count > 0) {
				await emitSubscriptionOutbox(
					tx,
					subgraphName,
					manifest,
					matcher,
					block.height,
				);
			}
			await applyProgress(tx, runResult);
		});
	} else {
		// Managed: a single atomic transaction on the target DB — unchanged.
		await targetDb.transaction().execute(async (tx: Transaction<Database>) => {
			const ctx = new SubgraphContext(
				tx,
				schemaName,
				subgraph.schema,
				blockMeta,
				initialTx,
			);

			const handlerStart = performance.now();
			const runResult = await runHandlers(subgraph, matched, ctx);
			handlerMs = performance.now() - handlerStart;

			result.processed = runResult.processed;
			result.errors = runResult.errors;

			if (ctx.pendingOps > 0) {
				const flushStart = performance.now();
				const manifest = await ctx.flush();
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

			await applyProgress(tx, runResult);
		});
	}

	const totalMs = performance.now() - blockStart;
	result.timing = {
		totalMs: Math.round(totalMs),
		handlerMs: Math.round(handlerMs),
		flushMs: Math.round(flushMs),
	};

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
	}

	return result;
}
