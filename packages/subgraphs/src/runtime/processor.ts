import { getErrorMessage } from "@secondlayer/shared";
import { getTargetDb } from "@secondlayer/shared/db";
import type { Subgraph } from "@secondlayer/shared/db";
import {
	listSubgraphs,
	updateSubgraphStatus,
} from "@secondlayer/shared/db/queries/subgraphs";
import { logger } from "@secondlayer/shared/logger";
import { listen } from "@secondlayer/shared/queue/listener";
import type { SubgraphDefinition } from "../types.ts";
import { catchUpSubgraph } from "./catchup.ts";
import { handleSubgraphReorg } from "./reorg.ts";

const CHANNEL_NEW_BLOCK = "indexer:new_block";
const DEFAULT_CONCURRENCY = 5;
const POLL_INTERVAL_MS = 5_000;

/**
 * URL to LISTEN on for indexer-fired channels (`indexer:new_block`,
 * `subgraph_reorg`). In dual-DB mode the indexer writes to the shared
 * source DB, so listeners must bind there. In single-DB mode this falls
 * back to `DATABASE_URL` — identical to pre-dual-DB behavior.
 */
function sourceListenerUrl(): string | undefined {
	return process.env.SOURCE_DATABASE_URL ?? process.env.DATABASE_URL;
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

	const mod = await import(`${sg.handler_path}?v=${Date.now()}`);
	const def = mod.default ?? mod;

	const prevVersion = knownVersions.get(sg.name);
	knownVersions.set(sg.name, sg.version);
	definitionCache.set(sg.name, def);

	if (prevVersion && prevVersion !== sg.version) {
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
		}
	}
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

	// Catch-up all subgraphs on startup (subgraphs table lives in target DB)
	const targetDb = getTargetDb();
	const activeSubgraphs = (await listSubgraphs(targetDb)).filter(
		(v: Subgraph) => v.status === "active",
	);
	for (const sg of activeSubgraphs) {
		try {
			const def = await loadSubgraphDefinition(sg);
			await catchUpSubgraph(def, sg.name);
		} catch (err) {
			const msg = getErrorMessage(err);
			if (isHandlerNotFoundError(err)) {
				await updateSubgraphStatus(targetDb, sg.name, "error");
			}
			logger.error("Subgraph catch-up failed on startup", {
				subgraph: sg.name,
				error: msg,
			});
		}
	}

	// Listen for new blocks — NOTIFY is fired from the indexer on the source DB
	const stopListening = await listen(
		CHANNEL_NEW_BLOCK,
		async () => {
			if (!running) return;
			// The NOTIFY payload doesn't include block height — we rely on
			// each subgraph's last_processed_block to determine what to process.
			// Trigger catch-up for all subgraphs.
			const db = getTargetDb();
			const subgraphs = (await listSubgraphs(db)).filter(
				(v: Subgraph) => v.status === "active",
			);
			cleanupCaches(subgraphs);
			for (const sg of subgraphs) {
				try {
					const def = await loadSubgraphDefinition(sg);
					await catchUpSubgraph(def, sg.name);
				} catch (err) {
					const msg = getErrorMessage(err);
					if (isHandlerNotFoundError(err)) {
						await updateSubgraphStatus(db, sg.name, "error");
					}
					logger.error("Subgraph processing failed", {
						subgraph: sg.name,
						error: msg,
					});
				}
			}
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
	const pollInterval = setInterval(async () => {
		if (!running) return;
		const db = getTargetDb();
		const subgraphs = (await listSubgraphs(db)).filter(
			(v: Subgraph) => v.status === "active",
		);
		cleanupCaches(subgraphs);
		for (const sg of subgraphs) {
			try {
				const def = await loadSubgraphDefinition(sg);
				await catchUpSubgraph(def, sg.name);
			} catch (err) {
				logger.error("Subgraph poll processing failed", {
					subgraph: sg.name,
					error: getErrorMessage(err),
				});
			}
		}
	}, POLL_INTERVAL_MS);

	logger.info("Subgraph processor ready");

	// Return shutdown function
	return async () => {
		running = false;
		clearInterval(pollInterval);
		await stopListening();
		await stopReorgListening();
		logger.info("Subgraph processor stopped");
	};
}
