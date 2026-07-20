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
 *
 * `handled` dedupes by reorg id across polls: a re-delivered reorg (cursor
 * bug, server restart, startup margin re-scan) must be a no-op, because the
 * rewind handler — while idempotent in outcome — aborts any in-flight catch-up
 * and resets subgraph cursors to the fork point. Re-delivery every poll would
 * pin subgraphs at the fork point forever (the 2026-07-19 prod incident).
 */
export async function pollReorgsOnce(
	http: ReorgLister,
	cursor: string,
	onReorg: OnReorg,
	handled?: Set<string>,
): Promise<string> {
	const { reorgs, next_since } = await http.listReorgs(cursor);
	const sorted = [...reorgs].sort(
		(a, b) => a.fork_point_height - b.fork_point_height,
	);
	for (const r of sorted) {
		if (handled && r.id && handled.has(r.id)) {
			logger.info("Streams reorg already handled — skipping", {
				forkPointHeight: r.fork_point_height,
				reorgId: r.id,
			});
			continue;
		}
		logger.info("Streams reorg — rewinding", {
			forkPointHeight: r.fork_point_height,
		});
		await onReorg(r.fork_point_height);
		// Only after a successful rewind — a throw must leave the reorg
		// eligible for retry on the next poll.
		if (handled && r.id) handled.add(r.id);
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
			process.env.STREAMS_INTERNAL_API_KEY ?? "sk-sl_streams_decode_internal",
	});

	let since = new Date(Date.now() - STARTUP_MARGIN_MS).toISOString();
	let running = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	// Reorg ids already applied this process. Reorgs are rare (~1/day), so an
	// unbounded-in-theory set stays tiny in practice; cap it anyway.
	const handled = new Set<string>();

	const tick = async (): Promise<void> => {
		if (!running) return;
		if (handled.size > 10_000) handled.clear();
		try {
			since = await pollReorgsOnce(http, since, onReorg, handled);
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
