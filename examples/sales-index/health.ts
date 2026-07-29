// The piece every "deploy a consumer" guide leaves out.
//
// Railway, Render, and Fly all decide a service is healthy by talking to it
// over HTTP. A bare `consume()` loop binds no port, so the platform sees a
// process that never answers and either restarts it forever or leaves it
// silently degraded. Serving one route fixes that — and the route is worth
// having anyway, because "is the loop still moving" is the only operational
// question that matters here.

import type { ConsumerBatchContext } from "@secondlayer/sdk";

/** Progress the loop has reported, read by `GET /health`. */
export const health = {
	ctx: null as ConsumerBatchContext | null,
	lastBatchAt: 0,
	startedAt: Date.now(),
};

/** Call at the top of `onBatch`, before any early return — a page with no
 *  matching rows is still proof the loop is alive. The consumer already tracks
 *  height and lag (holding both across empty pages, rolling them back on a
 *  reorg), so this just stamps the arrival time. */
export function recordProgress(ctx: ConsumerBatchContext): void {
	health.ctx = ctx;
	health.lastBatchAt = Date.now();
}

/**
 * Serves `GET /health` on `$PORT`.
 *
 * Liveness is "did a page land recently", not "are we near the tip" — during a
 * genesis backfill the loop is millions of blocks behind and perfectly
 * healthy, so lag can't be the gate. A wedged loop stops reporting pages and
 * flips to `503`, which is the signal the platform should restart on.
 * `blocks_behind` still ships in the body for dashboards and alerts.
 */
export function startHealthServer(staleAfterMs = 120_000) {
	return Bun.serve({
		port: Number(process.env.PORT ?? 8080),
		fetch(req) {
			if (new URL(req.url).pathname !== "/health") {
				return new Response("not found", { status: 404 });
			}
			// Before the first page there is nothing to be stale about — a cold
			// start is healthy while it opens its first connection.
			const idleMs = health.lastBatchAt ? Date.now() - health.lastBatchAt : 0;
			const ok = idleMs < staleAfterMs;
			return Response.json(
				{
					ok,
					checkpoint: health.ctx?.cursor ?? null,
					block_height: health.ctx?.height ?? null,
					tip_height: health.ctx?.tipHeight ?? null,
					blocks_behind: health.ctx?.blocksBehind ?? null,
					idle_s: Math.floor(idleMs / 1000),
					uptime_s: Math.floor((Date.now() - health.startedAt) / 1000),
				},
				{ status: ok ? 200 : 503 },
			);
		},
	});
}
