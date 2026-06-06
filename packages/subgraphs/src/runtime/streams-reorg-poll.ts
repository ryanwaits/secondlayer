import { getErrorMessage } from "@secondlayer/shared";
import { IndexHttpClient } from "@secondlayer/shared/index-http";
import { logger } from "@secondlayer/shared/logger";

const POLL_MS = Number(process.env.SUBGRAPH_REORG_POLL_MS) || 15_000;
// On boot, re-scan recent reorgs. Reorg handlers are idempotent, so re-applying
// a recent reorg is safe and covers any missed during downtime.
const STARTUP_MARGIN_MS = 60 * 60 * 1000;

type ReorgLister = Pick<IndexHttpClient, "listReorgs">;

/** Per-fork handler. Each plane (subgraph rewind, chain-subscription rewind)
 *  runs its own poll with its own handler, so they can live in separate
 *  processes once the subscription plane is extracted. */
export type OnReorg = (forkHeight: number) => Promise<void>;

/**
 * Fetch reorgs since `cursor` and invoke `onReorg` at each fork point (lowest
 * first), returning the next cursor. Extracted for testing.
 */
export async function pollReorgsOnce(
	http: ReorgLister,
	cursor: string,
	onReorg: OnReorg,
): Promise<string> {
	const { reorgs, next_since } = await http.listReorgs(cursor);
	const sorted = [...reorgs].sort(
		(a, b) => a.fork_point_height - b.fork_point_height,
	);
	for (const r of sorted) {
		logger.info("Streams reorg — rewinding", {
			forkPointHeight: r.fork_point_height,
		});
		await onReorg(r.fork_point_height);
	}
	return next_since ?? cursor;
}

/**
 * Streams as the reorg authority for `SUBGRAPH_SOURCE=streams-index`: poll
 * `/v1/streams/reorgs` and invoke `onReorg` at each fork point. Runs alongside
 * the Postgres `subgraph_reorg` LISTEN (which serves db-tap subgraphs); both
 * drive the same idempotent handler, so overlap is harmless.
 */
export function startStreamsReorgPoll(onReorg: OnReorg): () => void {
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
			since = await pollReorgsOnce(http, since, onReorg);
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
