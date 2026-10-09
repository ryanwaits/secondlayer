import { createHash, randomUUID } from "node:crypto";
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
	getSubgraphOperation,
	heartbeatSubgraphOperation,
	isActiveSubgraphOperationConflict,
} from "@secondlayer/shared/db/queries/subgraph-operations";
import {
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
import { isCatchUpLeader, startCatchUpLeader } from "./catchup-leader.ts";
import { catchUpSubgraph } from "./catchup.ts";
import { loadDeterministicDefinition } from "./realm.ts";
import { backfillSubgraph, reindexSubgraph, resumeReindex } from "./reindex.ts";
import { handleSubgraphReorg } from "./reorg.ts";
import { startStreamsReorgPoll } from "./streams-reorg-poll.ts";

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

/**
 * What the processor must reload on: the deployed handler's content, not the
 * version. A handler-only redeploy keeps the version (schema unchanged), so a
 * version key served the old handler until restart. `pin` covers the bundle
 * plus everything else that shapes rows; rows deployed before pins existed
 * hash their stored bundle; a local deploy (no stored bundle) runs a file in
 * place and keys on version + path, as before. The loading path (realm or
 * plain import) is part of the key.
 */
export function handlerCacheKey(
	sg: Pick<
		Subgraph,
		"pin" | "handler_code" | "handler_path" | "version" | "verification"
	>,
): string {
	const path = sg.verification?.level === "state" ? "realm" : "import";
	const content =
		sg.pin ??
		(sg.handler_code != null
			? createHash("sha256").update(sg.handler_code).digest("hex")
			: `${sg.version}:${sg.handler_path}`);
	return `${path}:${content}`;
}

// Hot-reload caches, keyed per subgraph by handlerCacheKey.
const knownKeys = new Map<string, string>();
const definitionCache = new Map<string, SubgraphDefinition>();

/**
 * Load a SubgraphDefinition, reusing the cache while the handler's content is
 * unchanged. Exported for tests.
 */
export async function loadSubgraphDefinition(
	sg: Subgraph,
): Promise<SubgraphDefinition> {
	const key = handlerCacheKey(sg);
	const cached = definitionCache.get(sg.name);
	if (cached && knownKeys.get(sg.name) === key) {
		return cached;
	}

	let def: SubgraphDefinition;
	if (sg.verification?.level === "state" && sg.handler_code) {
		// Verifiable (state-level, scan-clean at deploy): run in the deterministic realm.
		def = await loadDeterministicDefinition(sg.handler_code);
	} else if (sg.handler_code) {
		// Import the stored bundle from a data: URL, not a file. Bun caches
		// directory listings, so a handler file written after the processor's
		// first import is "not found"; the URL is also content-addressed, so a
		// new bundle is always a new module and the same bundle reuses its own.
		const url = `data:text/javascript;base64,${Buffer.from(sg.handler_code).toString("base64")}`;
		const mod = await import(url);
		def = mod.default ?? mod;
	} else {
		// Local deploy: the source file runs in place.
		const mod = await import(handlerImportUrl(sg.handler_path));
		def = mod.default ?? mod;
	}

	const prevKey = knownKeys.get(sg.name);
	knownKeys.set(sg.name, key);
	definitionCache.set(sg.name, def);

	if (prevKey && prevKey !== key) {
		// A redeploy changed the handler, so drop the cached route alongside
		// the handler def.
		invalidateSubgraphRoute(sg.name);
		logger.info("Subgraph handler reloaded", {
			subgraph: sg.name,
			version: sg.version,
		});
	}

	return def;
}

/** Remove cached entries for subgraphs that no longer exist. */
function cleanupCaches(active: Subgraph[]): void {
	const names = new Set(active.map((sg) => sg.name));
	for (const name of knownKeys.keys()) {
		if (!names.has(name)) {
			knownKeys.delete(name);
			definitionCache.delete(name);
			invalidateSubgraphRoute(name);
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
	if (subgraph.status === "paused") return 0;

	const def = await loadSubgraphDefinition(subgraph);
	const schemaName = subgraph.schema_name ?? pgSchemaName(subgraph.name);

	let processed = 0;
	if (operation.kind === "backfill") {
		if (operation.from_block == null || operation.to_block == null) {
			throw new Error("Backfill operation is missing from_block or to_block");
		}
		// Resume from the op's own checkpoint: committed blocks never replay.
		const resumeFrom =
			operation.cursor_block != null
				? Math.max(
						Number(operation.from_block),
						Number(operation.cursor_block) + 1,
					)
				: Number(operation.from_block);
		const result = await backfillSubgraph(def, {
			fromBlock: resumeFrom,
			toBlock: Number(operation.to_block),
			schemaName,
			operationId: operation.id,
			signal,
		});
		processed = result.processed;
	} else {
		const hasResumeMetadata =
			subgraph.status === "reindexing" &&
			subgraph.reindex_from_block != null &&
			subgraph.reindex_to_block != null;

		if (hasResumeMetadata) {
			const result = await resumeReindex(def, {
				schemaName,
				operationId: operation.id,
				signal,
			});
			processed = result.processed;
		} else {
			const result = await reindexSubgraph(def, {
				// Policy floor only — a reindex always rebuilds [start_block, chain tip].
				// `operation.to_block` is progress/resume metadata, never a walk bound:
				// bounding the walk while the drop stays unconditional is what destroyed
				// sbtc-flows' history (f079).
				startBlockFloor:
					operation.from_block == null
						? undefined
						: Number(operation.from_block),
				schemaName,
				operationId: operation.id,
				signal,
			});
			processed = result.processed;
		}
	}
	return processed;
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

	// Boot-time resume sweep: a processor restart strands any reindex that was
	// started inline (deploy-time genesis) or whose op died with the old
	// instance — the subgraph sits at status='reindexing' and nothing ever
	// picks it up. Re-enqueue a reindex op for each; with resume metadata the
	// run path resumes from last_processed_block + 1, without it the reindex
	// starts over. The active-op partial-unique constraint makes double-enqueue
	// a no-op.
	try {
		const stranded = await db
			.selectFrom("subgraphs")
			.select(["id", "name", "account_id"])
			.where("status", "=", "reindexing")
			.where(({ not, exists, selectFrom }) =>
				not(
					exists(
						selectFrom("subgraph_operations")
							.select("id")
							.whereRef("subgraph_id", "=", "subgraphs.id")
							.where("status", "in", ["queued", "running"]),
					),
				),
			)
			.execute();
		for (const row of stranded) {
			try {
				await createSubgraphOperation(db, {
					subgraphId: row.id,
					subgraphName: row.name,
					accountId: row.account_id,
					kind: "reindex",
				});
				logger.info("Re-enqueued stranded reindex", { subgraph: row.name });
			} catch (err) {
				if (!isActiveSubgraphOperationConflict(err)) throw err;
			}
		}
	} catch (err) {
		// The sweep is best-effort — a failure must not stop the runner.
		logger.warn("Stranded-reindex sweep failed", {
			error: getErrorMessage(err),
		});
	}

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
	// drive the idempotent subgraph-reorg handler. The chain-webhook reorg
	// rewind runs on its own poll inside the webhook plane below.
	const stopStreamsReorgPoll =
		process.env.SUBGRAPH_SOURCE === "streams-index"
			? startStreamsReorgPoll((forkHeight) =>
					handleSubgraphReorg(forkHeight, loadSubgraphDefinition),
				)
			: undefined;

	// The real-time webhook delivery plane (evaluator + emitter + chain-reorg)
	// now runs in the dedicated webhook-processor service, isolated from
	// subgraph indexing. This process handles subgraph ops + catch-up + the
	// subgraph-reorg rewind only.

	logger.info("Subgraph processor ready");

	// Return shutdown function
	return async () => {
		running = false;
		clearInterval(pollInterval);
		await stopCatchUpLeader();
		await stopListening();
		await stopReorgListening();
		stopStreamsReorgPoll?.();
		await stopOperations();
		logger.info("Subgraph processor stopped");
	};
}
