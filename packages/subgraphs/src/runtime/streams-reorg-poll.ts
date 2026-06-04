import { getErrorMessage } from "@secondlayer/shared";
import type { Subgraph } from "@secondlayer/shared/db";
import { IndexHttpClient } from "@secondlayer/shared/index-http";
import { logger } from "@secondlayer/shared/logger";
import type { SubgraphDefinition } from "../types.ts";

const POLL_MS = Number(process.env.SUBGRAPH_REORG_POLL_MS) || 15_000;
// On boot, re-scan recent reorgs. `handleSubgraphReorg` is idempotent (delete
// `>= height` + dedup-keyed `.reverted` + replace-per-height reprocess), so
// re-applying a recent reorg is safe and covers any missed during downtime.
const STARTUP_MARGIN_MS = 60 * 60 * 1000;

type HandleReorg = (
	blockHeight: number,
	loadDef: (sg: Subgraph) => Promise<SubgraphDefinition>,
) => Promise<void>;

type ReorgLister = Pick<IndexHttpClient, "listReorgs">;

/** Optional per-reorg hook for direct chain-level subscriptions — rewinds the
 *  evaluator + emits rollbacks off the same reorg signal. */
type HandleChainReorg = (forkHeight: number) => Promise<void>;

/**
 * Fetch reorgs since `cursor` and rewind subgraphs (and, if provided, chain
 * subscriptions) at each fork point (lowest first), returning the next cursor.
 * Extracted for testing.
 */
export async function pollReorgsOnce(
	http: ReorgLister,
	cursor: string,
	handleReorg: HandleReorg,
	loadDef: (sg: Subgraph) => Promise<SubgraphDefinition>,
	handleChainReorg?: HandleChainReorg,
): Promise<string> {
	const { reorgs, next_since } = await http.listReorgs(cursor);
	const sorted = [...reorgs].sort(
		(a, b) => a.fork_point_height - b.fork_point_height,
	);
	for (const r of sorted) {
		logger.info("Streams reorg — rewinding subgraphs", {
			forkPointHeight: r.fork_point_height,
		});
		await handleReorg(r.fork_point_height, loadDef);
		if (handleChainReorg) await handleChainReorg(r.fork_point_height);
	}
	return next_since ?? cursor;
}

/**
 * Streams as the reorg authority for `SUBGRAPH_SOURCE=streams-index`: poll
 * `/v1/streams/reorgs` and rewind subgraphs at each fork point. Runs alongside
 * the Postgres `subgraph_reorg` LISTEN (which serves db-tap subgraphs); both
 * drive the same idempotent handler, so overlap is harmless.
 */
export function startStreamsReorgPoll(
	handleReorg: HandleReorg,
	loadDef: (sg: Subgraph) => Promise<SubgraphDefinition>,
	handleChainReorg?: HandleChainReorg,
): () => void {
	const baseUrl =
		process.env.SUBGRAPH_INDEX_API_URL ??
		process.env.STREAMS_API_URL ??
		"http://api:3800";
	const http = new IndexHttpClient({
		indexBaseUrl: baseUrl,
		streamsBaseUrl: baseUrl,
		streamsApiKey:
			process.env.STREAMS_INTERNAL_API_KEY ?? "sk-sl_streams_l2_internal",
	});

	let since = new Date(Date.now() - STARTUP_MARGIN_MS).toISOString();
	let running = true;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const tick = async (): Promise<void> => {
		if (!running) return;
		try {
			since = await pollReorgsOnce(
				http,
				since,
				handleReorg,
				loadDef,
				handleChainReorg,
			);
		} catch (err) {
			logger.error("Streams reorg poll failed", {
				error: getErrorMessage(err),
			});
		}
		if (running) timer = setTimeout(tick, POLL_MS);
	};

	timer = setTimeout(tick, POLL_MS);
	logger.info("Streams reorg poll started", { pollMs: POLL_MS });
	return () => {
		running = false;
		if (timer) clearTimeout(timer);
	};
}
