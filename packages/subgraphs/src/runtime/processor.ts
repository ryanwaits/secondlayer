import { getErrorMessage } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
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

const CHANNEL_NEW_BLOCK = "streams:new_job";
const DEFAULT_CONCURRENCY = 5;
const POLL_INTERVAL_MS = 5_000;

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
 * Load a SubgraphDefinition from its handler file path.
 */
async function loadSubgraphDefinition(
	handlerPath: string,
): Promise<SubgraphDefinition> {
	const mod = await import(handlerPath);
	return mod.default ?? mod;
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

	// Catch-up all subgraphs on startup
	const db = getDb();
	const activeSubgraphs = (await listSubgraphs(db)).filter(
		(v: Subgraph) => v.status === "active",
	);
	for (const sg of activeSubgraphs) {
		try {
			const def = await loadSubgraphDefinition(sg.handler_path);
			await catchUpSubgraph(def, sg.name);
		} catch (err) {
			const msg = getErrorMessage(err);
			if (isHandlerNotFoundError(err)) {
				await updateSubgraphStatus(db, sg.name, "error");
			}
			logger.error("Subgraph catch-up failed on startup", {
				subgraph: sg.name,
				error: msg,
			});
		}
	}

	// Listen for new blocks
	const stopListening = await listen(CHANNEL_NEW_BLOCK, async () => {
		if (!running) return;
		// The NOTIFY payload doesn't include block height — we rely on
		// each subgraph's last_processed_block to determine what to process.
		// Trigger catch-up for all subgraphs.
		const db = getDb();
		const subgraphs = (await listSubgraphs(db)).filter(
			(v: Subgraph) => v.status === "active",
		);
		for (const sg of subgraphs) {
			try {
				const def = await loadSubgraphDefinition(sg.handler_path);
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
	});

	// Listen for reorgs
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
	);

	// Poll as backup
	const pollInterval = setInterval(async () => {
		if (!running) return;
		const db = getDb();
		const subgraphs = (await listSubgraphs(db)).filter(
			(v: Subgraph) => v.status === "active",
		);
		for (const sg of subgraphs) {
			try {
				const def = await loadSubgraphDefinition(sg.handler_path);
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
