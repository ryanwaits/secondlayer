import type { ConsumerBatchContext } from "./streams/types.ts";

/**
 * The two pieces every "deploy a consumer" guide leaves out, packaged:
 * a liveness endpoint and a graceful-shutdown signal. Both are
 * runtime-agnostic — the SDK never binds a port or assumes Bun/Node.
 */

export interface ConsumerHealth {
	/** Feed this to the consume loop's `onProgress` — it stamps arrival time
	 *  and keeps the latest progress ctx for the health body. */
	record: (ctx: ConsumerBatchContext) => void;
	/** Fetch-style handler for `GET /health`. Mount it on whatever serves
	 *  HTTP in your runtime:
	 *  `Bun.serve({ port, fetch: health.handler })` ·
	 *  `http.createServer(...)` via an adapter · a Workers route. */
	handler: (req: Request) => Response;
}

/**
 * Liveness for a consume loop. The gate is "did a page land recently", NOT
 * "are we near the tip": during a genesis backfill the loop is millions of
 * blocks behind and perfectly healthy, so lag can't be the signal. A wedged
 * loop stops reporting pages and flips to 503 — that's what platforms
 * should restart on. The body carries position for dashboards:
 * `blocks_behind` is the actual backlog (`tip - scanned_height`, ~0 for a
 * caught-up tail even on a quiet contract), while `block_height` is the
 * last DELIVERED row — its distance from the tip is event age, not lag.
 */
export function consumerHealth(
	options: { staleAfterMs?: number } = {},
): ConsumerHealth {
	const staleAfterMs = options.staleAfterMs ?? 120_000;
	const startedAt = Date.now();
	let lastCtx: ConsumerBatchContext | null = null;
	let lastBatchAt = 0;

	return {
		record(ctx) {
			lastCtx = ctx;
			lastBatchAt = Date.now();
		},
		handler(req) {
			if (new URL(req.url).pathname !== "/health") {
				return new Response("not found", { status: 404 });
			}
			// Before the first page there is nothing to be stale about — a cold
			// start is healthy while it opens its first connection.
			const idleMs = lastBatchAt ? Date.now() - lastBatchAt : 0;
			const ok = idleMs < staleAfterMs;
			return Response.json(
				{
					ok,
					checkpoint: lastCtx?.cursor ?? null,
					block_height: lastCtx?.height ?? null,
					scanned_height: lastCtx?.scannedHeight ?? null,
					tip_height: lastCtx?.tipHeight ?? null,
					blocks_behind: lastCtx?.blocksBehind ?? null,
					idle_s: Math.floor(idleMs / 1000),
					uptime_s: Math.floor((Date.now() - startedAt) / 1000),
				},
				{ status: ok ? 200 : 503 },
			);
		},
	};
}

/**
 * An `AbortSignal` wired to SIGTERM/SIGINT (redeploys arrive as SIGTERM).
 * Pass it as the consume loop's `signal`: aborting is checked at the top of
 * the loop, never mid-batch, so the in-flight transaction — rows AND
 * checkpoint — always commits before the process exits. Nothing is
 * half-written; the next run resumes from exactly that cursor.
 *
 * No-op (never fires) on runtimes without `process` signal handling.
 */
export function shutdownSignal(
	options: { signals?: readonly ("SIGTERM" | "SIGINT")[] } = {},
): AbortSignal {
	const controller = new AbortController();
	if (typeof process !== "undefined" && typeof process.on === "function") {
		for (const signal of options.signals ?? ["SIGTERM", "SIGINT"]) {
			process.on(signal, () => {
				controller.abort(new Error(`${signal} — finishing the current batch`));
			});
		}
	}
	return controller.signal;
}
