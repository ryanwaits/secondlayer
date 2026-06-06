import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getErrorMessage } from "@secondlayer/shared";
import { getTargetDb } from "@secondlayer/shared/db";
import type { Subgraph, SubgraphOperation } from "@secondlayer/shared/db";
import {
	cancelSubgraphOperation,
	claimSubgraphOperation,
	completeSubgraphOperation,
	createSubgraphOperation,
	failSubgraphOperation,
	findActiveSubgraphOperation,
	getSubgraphOperation,
	heartbeatSubgraphOperation,
	isActiveSubgraphOperationConflict,
} from "@secondlayer/shared/db/queries/subgraph-operations";
import {
	isByoSubgraph,
	listSubgraphs,
	pgSchemaName,
	updateSubgraphStatus,
} from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import {
	listen,
	sourceListenerUrl,
	targetListenerUrl,
} from "@secondlayer/shared/queue/listener";
import type { SubgraphDefinition } from "../types.ts";
import { invalidateSubgraphRoute } from "./block-processor.ts";
import { catchUpSubgraph } from "./catchup.ts";
import { isCatchUpLeader, startCatchUpLeader } from "./catchup-leader.ts";
import { backfillSubgraph, reindexSubgraph, resumeReindex } from "./reindex.ts";
import { handleSubgraphReorg } from "./reorg.ts";
import { startStreamsReorgPoll } from "./streams-reorg-poll.ts";
import { startSubscriptionPlane } from "./subscription-plane.ts";

const CHANNEL_NEW_BLOCK = "indexer:new_block";
const CHANNEL_SUBGRAPH_OPERATIONS = "subgraph_operations:new";
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_OPERATION_CONCURRENCY = 1;
const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const CANCEL_POLL_INTERVAL_MS = 1_000;

/**
 * Fan-out catch-up across multiple subgraphs with a bounded concurrency pool.
 * Each subgraph's catchUpSubgraph() call is independent — different target
 * schemas, read-only source access. The catchingUp set in catchup.ts guards
 * per-subgraph re-entrancy so concurrent calls for the same name are safe.
 */
async function catchUpAll(
	subgraphs: Subgraph[],
	db: ReturnType<typeof getTargetDb>,
	concurrency: number,
): Promise<void> {
	const queue = [...subgraphs];
	const workers = Array.from(
		{ length: Math.min(concurrency, queue.length) },
		async () => {
			while (queue.length > 0) {
				const sg = queue.shift();
				if (!sg) break;
				try {
					const def = await loadSubgraphDefinition(sg);
					await catchUpSubgraph(def, sg.name);
				} catch (err) {
					const msg = getErrorMessage(err);
					if (isHandlerNotFoundError(err)) {
						await updateSubgraphStatus(db, sg.name, "error");
					}
					logger.error("Subgraph catch-up failed", {
						subgraph: sg.name,
						error: msg,
					});
				}
			}
		},
	);
	await Promise.allSettled(workers);
}

function handlerImportUrl(handlerPath: string, cacheBust = Date.now()) {
	return `${pathToFileURL(resolve(handlerPath)).href}?t=${cacheBust}`;
}

function isHandlerNotFoundError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const code = (err as NodeJS.ErrnoException).code;
	if (
		code === "MODULE_NOT_FOUND" ||
		code === "ERR_MODULE_NOT_FOUND" ||
		code === "ENOENT"
	)
		return true;
	// fallback: Bun may not always set code on dynamic import failures
	return (
		err.message.includes("Cannot find module") || err.message.includes("ENOENT")
	);
}

// Caches for hot-reload detection — only re-import when version changes
const knownVersions = new Map<string, string>();
const definitionCache = new Map<string, SubgraphDefinition>();

/**
 * Load a SubgraphDefinition, reusing the cache unless the version changed.
 * On version change, writes latest handler_code from DB to disk and
 * cache-busts the dynamic import.
 */
async function loadSubgraphDefinition(
	sg: Subgraph,
): Promise<SubgraphDefinition> {
	const cached = definitionCache.get(sg.name);
	if (cached && knownVersions.get(sg.name) === sg.version) {
		return cached;
	}

	// Write latest handler code from DB to disk before importing
	if (sg.handler_code) {
		const { mkdirSync, writeFileSync } = await import("node:fs");
		const { dirname } = await import("node:path");
		mkdirSync(dirname(sg.handler_path), { recursive: true });
		writeFileSync(sg.handler_path, sg.handler_code);
	}

	const mod = await import(handlerImportUrl(sg.handler_path));
	const def = mod.default ?? mod;

	const prevVersion = knownVersions.get(sg.name);
	knownVersions.set(sg.name, sg.version);
	definitionCache.set(sg.name, def);

	if (prevVersion && prevVersion !== sg.version) {
		// A redeploy can change the data-plane connection (BYO toggled/rotated),
		// so drop the cached route alongside the handler def.
		invalidateSubgraphRoute(sg.name);
		logger.info("Subgraph handler reloaded", {
			subgraph: sg.name,
			from: prevVersion,
			to: sg.version,
		});
	}

	return def;
}

/** Remove cached entries for subgraphs that no longer exist. */
function cleanupCaches(active: Subgraph[]): void {
	const names = new Set(active.map((sg) => sg.name));
	for (const name of knownVersions.keys()) {
		if (!names.has(name)) {
			knownVersions.delete(name);
			definitionCache.delete(name);
			invalidateSubgraphRoute(name);
		}
	}
}

async function synthesizeLegacyReindexOperations(): Promise<void> {
	const db = getTargetDb();
	const stale = (await listSubgraphs(db)).filter(
		(sg) => sg.status === "reindexing",
	);

	for (const sg of stale) {
		const active = await findActiveSubgraphOperation(db, sg.id);
		if (active) continue;

		try {
			await createSubgraphOperation(db, {
				subgraphId: sg.id,
				subgraphName: sg.name,
				accountId: sg.account_id,
				kind: "reindex",
				fromBlock:
					sg.reindex_from_block == null
						? undefined
						: Number(sg.reindex_from_block),
				toBlock:
					sg.reindex_to_block == null ? undefined : Number(sg.reindex_to_block),
			});
			logger.info("Queued legacy reindex resume operation", {
				subgraph: sg.name,
			});
		} catch (err) {
			if (isActiveSubgraphOperationConflict(err)) continue;
			throw err;
		}
	}
}

async function runSubgraphOperation(
	operation: SubgraphOperation,
	signal: AbortSignal,
): Promise<number> {
	if (operation.cancel_requested) {
		return 0;
	}

	const db = getTargetDb();
	const subgraph = await db
		.selectFrom("subgraphs")
		.selectAll()
		.where("id", "=", operation.subgraph_id)
		.executeTakeFirst();
	if (!subgraph)
		throw new Error(`Subgraph not found: ${operation.subgraph_id}`);

	const def = await loadSubgraphDefinition(subgraph);
	const schemaName = subgraph.schema_name ?? pgSchemaName(subgraph.name);

	if (operation.kind === "backfill") {
		if (operation.from_block == null || operation.to_block == null) {
			throw new Error("Backfill operation is missing from_block or to_block");
		}
		const result = await backfillSubgraph(def, {
			fromBlock: Number(operation.from_block),
			toBlock: Number(operation.to_block),
			schemaName,
			signal,
		});
		return result.processed;
	}

	// Reindex drops + recreates the schema. On a BYO subgraph that would destroy
	// data in the user's DB from a background job, so it's blocked — the user
	// re-deploys to rebuild. Initial population uses a `backfill` op (handled
	// above), which never drops.
	if (isByoSubgraph(subgraph)) {
		throw new Error(
			`Reindex is not supported for BYO subgraphs ("${subgraph.name}"). Re-deploy to rebuild, or drop and recreate the schema in your database.`,
		);
	}

	const hasResumeMetadata =
		subgraph.status === "reindexing" &&
		subgraph.reindex_from_block != null &&
		subgraph.reindex_to_block != null;

	if (hasResumeMetadata) {
		const result = await resumeReindex(def, { schemaName, signal });
		return result.processed;
	}

	const result = await reindexSubgraph(def, {
		fromBlock:
			operation.from_block == null ? undefined : Number(operation.from_block),
		toBlock:
			operation.to_block == null ? undefined : Number(operation.to_block),
		schemaName,
		signal,
	});
	return result.processed;
}

export async function startSubgraphOperationRunner(opts?: {
	concurrency?: number;
}): Promise<() => Promise<void>> {
	const concurrency = opts?.concurrency ?? DEFAULT_OPERATION_CONCURRENCY;
	const db = getTargetDb();
	const lockedBy = `${hostname()}:${process.pid}:${randomUUID()}`;
	const active = new Map<string, AbortController>();
	const activeRuns = new Map<string, Promise<void>>();
	let running = true;
	let draining = false;

	logger.info("Starting subgraph operation runner", { concurrency, lockedBy });

	const startOperation = (operation: SubgraphOperation) => {
		const controller = new AbortController();
		active.set(operation.id, controller);

		const heartbeat = setInterval(() => {
			if (!running) return;
			heartbeatSubgraphOperation(db, operation.id, lockedBy).catch((err) => {
				logger.warn("Subgraph operation heartbeat failed", {
					operationId: operation.id,
					error: getErrorMessage(err),
				});
			});
		}, HEARTBEAT_INTERVAL_MS);

		const cancelPoll = setInterval(() => {
			getSubgraphOperation(db, operation.id)
				.then((row) => {
					if ((!row || row.cancel_requested) && !controller.signal.aborted) {
						controller.abort("user-cancelled");
					}
				})
				.catch((err) => {
					logger.warn("Subgraph operation cancel poll failed", {
						operationId: operation.id,
						error: getErrorMessage(err),
					});
				});
		}, CANCEL_POLL_INTERVAL_MS);

		const run = (async () => {
			let processed = 0;
			try {
				if (operation.cancel_requested) {
					controller.abort("user-cancelled");
				} else {
					processed = await runSubgraphOperation(operation, controller.signal);
				}

				const reason = String(controller.signal.reason ?? "");
				if (controller.signal.aborted && reason === "user-cancelled") {
					await cancelSubgraphOperation(db, operation.id, lockedBy, processed);
					logger.info("Subgraph operation cancelled", {
						operationId: operation.id,
						subgraph: operation.subgraph_name,
					});
					return;
				}
				if (controller.signal.aborted) {
					logger.info("Subgraph operation interrupted", {
						operationId: operation.id,
						subgraph: operation.subgraph_name,
						reason,
					});
					return;
				}

				await completeSubgraphOperation(db, operation.id, lockedBy, processed);
				logger.info("Subgraph operation completed", {
					operationId: operation.id,
					subgraph: operation.subgraph_name,
					processed,
				});
			} catch (err) {
				const reason = String(controller.signal.reason ?? "");
				if (controller.signal.aborted && reason === "shutdown") {
					logger.info("Subgraph operation interrupted by shutdown", {
						operationId: operation.id,
						subgraph: operation.subgraph_name,
					});
					return;
				}
				if (controller.signal.aborted && reason === "user-cancelled") {
					await cancelSubgraphOperation(db, operation.id, lockedBy, processed);
					return;
				}
				await failSubgraphOperation(
					db,
					operation.id,
					lockedBy,
					getErrorMessage(err),
					processed,
				);
				logger.error("Subgraph operation failed", {
					operationId: operation.id,
					subgraph: operation.subgraph_name,
					error: getErrorMessage(err),
				});
			} finally {
				clearInterval(heartbeat);
				clearInterval(cancelPoll);
				active.delete(operation.id);
				activeRuns.delete(operation.id);
				if (running) void drain();
			}
		})();

		activeRuns.set(operation.id, run);
	};

	const drain = async () => {
		if (!running || draining) return;
		draining = true;
		try {
			while (running && active.size < concurrency) {
				const operation = await claimSubgraphOperation(db, lockedBy);
				if (!operation) break;
				startOperation(operation);
			}
		} finally {
			draining = false;
		}
	};

	await synthesizeLegacyReindexOperations();
	await drain();

	const stopListening = await listen(
		CHANNEL_SUBGRAPH_OPERATIONS,
		() => {
			void drain();
		},
		{ connectionString: targetListenerUrl() },
	);

	const pollInterval = setInterval(() => {
		void drain();
	}, POLL_INTERVAL_MS);

	return async () => {
		running = false;
		clearInterval(pollInterval);
		await stopListening();
		for (const controller of active.values()) {
			controller.abort("shutdown");
		}
		await Promise.allSettled(activeRuns.values());
		logger.info("Subgraph operation runner stopped");
	};
}

/**
 * Start the subgraph processor service.
 * Listens for new blocks via NOTIFY and processes them through all active subgraphs.
 */
export async function startSubgraphProcessor(opts?: {
	concurrency?: number;
}): Promise<() => Promise<void>> {
	const concurrency = opts?.concurrency ?? DEFAULT_CONCURRENCY;
	let running = true;

	logger.info("Starting subgraph processor", { concurrency });

	const stopOperations = await startSubgraphOperationRunner({
		concurrency: Number.parseInt(
			process.env.SUBGRAPH_OPERATION_CONCURRENCY ??
				String(DEFAULT_OPERATION_CONCURRENCY),
		),
	});

	// One catch-up pass over all active subgraphs (subgraphs table lives in the
	// target DB). Gated on the catch-up leader: only one process across the fleet
	// drives catch-up, so scale-out adds capacity instead of double-processing
	// every block. The in-process Set in catchup.ts still guards within a process.
	const runCatchUp = async (): Promise<void> => {
		if (!running || !isCatchUpLeader()) return;
		const db = getTargetDb();
		const subgraphs = (await listSubgraphs(db)).filter(
			(v: Subgraph) => v.status === "active",
		);
		cleanupCaches(subgraphs);
		await catchUpAll(subgraphs, db, concurrency);
	};

	// Elect a single catch-up leader; the new leader runs an immediate pass so it
	// doesn't wait a poll interval. NOTIFY/poll below are no-ops on non-leaders.
	const stopCatchUpLeader = startCatchUpLeader({ onAcquire: runCatchUp });

	// Listen for new blocks — NOTIFY is fired from the indexer on the source DB
	const stopListening = await listen(
		CHANNEL_NEW_BLOCK,
		async () => {
			// The NOTIFY payload doesn't include block height — we rely on each
			// subgraph's last_processed_block to determine what to process.
			await runCatchUp();
		},
		{ connectionString: sourceListenerUrl() },
	);

	// Listen for reorgs — also fired from the indexer on the source DB
	const stopReorgListening = await listen(
		"subgraph_reorg",
		async (payload: string | undefined) => {
			if (!running) return;
			try {
				const data = JSON.parse(payload ?? "{}");
				const blockHeight = data.blockHeight;
				if (typeof blockHeight === "number") {
					await handleSubgraphReorg(blockHeight, loadSubgraphDefinition);
				}
			} catch (err) {
				logger.error("Subgraph reorg handling failed", {
					error: getErrorMessage(err),
				});
			}
		},
		{ connectionString: sourceListenerUrl() },
	);

	// Poll as backup (reads subgraphs table — target DB)
	const pollInterval = setInterval(() => {
		void runCatchUp();
	}, POLL_INTERVAL_MS);

	// Streams is the reorg authority for streams-index subgraphs (the public
	// API path has no Postgres NOTIFY). Runs alongside the LISTEN above; both
	// drive the idempotent subgraph-reorg handler. The chain-subscription reorg
	// rewind runs on its own poll inside the subscription plane below.
	const stopStreamsReorgPoll =
		process.env.SUBGRAPH_SOURCE === "streams-index"
			? startStreamsReorgPoll((forkHeight) =>
					handleSubgraphReorg(forkHeight, loadSubgraphDefinition),
				)
			: undefined;

	// Boot the real-time subscription delivery plane (evaluator + emitter +
	// chain-reorg) in the same process for now. The two-deploy cutover moves it to
	// a dedicated subscription-processor service and removes this call.
	const stopSubscriptionPlane = await startSubscriptionPlane();

	logger.info("Subgraph processor ready");

	// Return shutdown function
	return async () => {
		running = false;
		clearInterval(pollInterval);
		await stopCatchUpLeader();
		await stopListening();
		await stopReorgListening();
		stopStreamsReorgPoll?.();
		await stopSubscriptionPlane();
		await stopOperations();
		logger.info("Subgraph processor stopped");
	};
}
