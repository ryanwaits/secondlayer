import { type Database, getDb } from "@secondlayer/shared/db";
import {
	recordSubgraphProcessed,
	updateSubgraphStatus,
} from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import { type Transaction, sql } from "kysely";
import { pgSchemaName } from "../schema/utils.ts";
import type { SubgraphDefinition } from "../types.ts";
import { type BlockMeta, SubgraphContext, type TxMeta } from "./context.ts";
import { runHandlers } from "./runner.ts";
import { matchSources } from "./source-matcher.ts";

// Cache schema_name per subgraph to avoid per-block DB lookups
const schemaNameCache = new Map<string, string>();

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
	const db = getDb();
	const blockStart = performance.now();
	const result: ProcessBlockResult = {
		blockHeight,
		matched: 0,
		processed: 0,
		errors: 0,
		skipped: false,
	};

	// 1. Load block (use pre-loaded data if available, otherwise fetch from DB)
	let block, txs, evts;
	if (opts?.preloaded) {
		block = opts.preloaded.block;
		txs = opts.preloaded.txs;
		evts = opts.preloaded.events;
	} else {
		block = await db
			.selectFrom("blocks")
			.selectAll()
			.where("height", "=", blockHeight)
			.executeTakeFirst();

		if (!block) {
			logger.warn("Block not found for subgraph processing", {
				subgraph: subgraphName,
				blockHeight,
			});
			result.skipped = true;
			return result;
		}

		if (!block.canonical) {
			logger.debug("Skipping non-canonical block", {
				subgraph: subgraphName,
				blockHeight,
			});
			result.skipped = true;
			return result;
		}

		// 2. Load txs + events
		txs = await db
			.selectFrom("transactions")
			.selectAll()
			.where("block_height", "=", blockHeight)
			.execute();

		evts = await db
			.selectFrom("events")
			.selectAll()
			.where("block_height", "=", blockHeight)
			.execute();
	}

	// 3. Match source
	const matched = matchSources(subgraph.sources, txs, evts);
	result.matched = matched.length;

	if (matched.length === 0) {
		if (!opts?.skipProgressUpdate) {
			await updateSubgraphStatus(db, subgraphName, "active", blockHeight);
		}
		return result;
	}

	// 4. Create context and run handlers
	// Use cached schema_name (fetched once per subgraph, not per block)
	let schemaName = schemaNameCache.get(subgraphName);
	if (!schemaName) {
		const subgraphRecord = await db
			.selectFrom("subgraphs")
			.select("schema_name")
			.where("name", "=", subgraphName)
			.executeTakeFirst();
		schemaName = subgraphRecord?.schema_name ?? pgSchemaName(subgraphName);
		schemaNameCache.set(subgraphName, schemaName);
	}
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

	// Wrap entire block processing in a single transaction
	let handlerMs = 0;
	let flushMs = 0;

	await db.transaction().execute(async (tx: Transaction<Database>) => {
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

		// 5. Flush writes
		if (ctx.pendingOps > 0) {
			const flushStart = performance.now();
			await ctx.flush();
			flushMs = performance.now() - flushStart;
		}

		// 6. Update progress + health metrics (same transaction)
		if (!opts?.skipProgressUpdate) {
			const status =
				runResult.errors > 0 && runResult.processed === 0 ? "error" : "active";
			await updateSubgraphStatus(tx, subgraphName, status, blockHeight);
		}

		if (
			!opts?.skipProgressUpdate &&
			(runResult.processed > 0 || runResult.errors > 0)
		) {
			const lastError =
				runResult.errors > 0
					? `${runResult.errors} error(s) at block ${blockHeight}`
					: undefined;
			await recordSubgraphProcessed(
				tx,
				subgraphName,
				runResult.processed,
				runResult.errors,
				lastError,
			);
		}
	});

	const totalMs = performance.now() - blockStart;
	result.timing = {
		totalMs: Math.round(totalMs),
		handlerMs: Math.round(handlerMs),
		flushMs: Math.round(flushMs),
	};

	// 7. Row count warning — sample every 1000 blocks
	if (blockHeight % 1000 === 0) {
		try {
			const tables = Object.keys(subgraph.schema);
			for (const table of tables) {
				const { rows } = await sql
					.raw(`SELECT COUNT(*) as count FROM "${schemaName}"."${table}"`)
					.execute(db);
				const count = Number((rows[0] as Record<string, unknown>).count);
				if (count >= 10_000_000) {
					logger.warn("Subgraph table exceeds 10M rows", {
						subgraph: subgraphName,
						table,
						count,
					});
				}
			}
		} catch {
			// Table may not exist yet
		}
	}

	return result;
}
