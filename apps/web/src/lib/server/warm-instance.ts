// Server-only: pulls in undici and the highlighter.
import { PLATFORM_API_URL } from "@/lib/api";
import {
	claimHighlighterWarmup,
	recordWarmup,
	recordWarmupFailure,
} from "@/lib/server/cold-start";
import { upstreamAgent } from "@/lib/upstream-agent";
import type { Agent } from "undici";

/** A connect that hasn't answered by now is recorded as failed, not left pending. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Opens the keep-alive connection to the API, which a new instance's first
 * request would otherwise pay for. Returns at once; it runs in the background
 * and a failure is recorded, not retried: that request pays as it did before.
 * The highlighter is not warmed here (see `warmHighlighter`), because its
 * grammar load blocks the event loop and would delay this connect and the
 * first request.
 */
export function warmInstance(): void {
	const agentStart = performance.now();
	void fetch(`${PLATFORM_API_URL}/health`, {
		cache: "no-store",
		dispatcher: upstreamAgent,
		signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
	} as RequestInit & { dispatcher: Agent })
		.then((res) => {
			recordWarmup("agentConnectMs", agentStart);
			return res.body?.cancel();
		})
		.catch((err) => recordWarmupFailure("agentConnectMs", err));
}

/**
 * Loads the highlighter's grammars and themes, once per instance. Called after
 * a response has gone out, so the instance's first request doesn't wait on it
 * and later pages that render code (webhook and subgraph detail) find it warm.
 */
export function warmHighlighter(): void {
	if (!claimHighlighterWarmup()) return;
	const start = performance.now();
	void import("@/components/code/code")
		.then(({ renderCode }) =>
			renderCode({ code: "const warm = 1;", lang: "ts" }),
		)
		.then(() => recordWarmup("highlighterMs", start))
		.catch((err) => recordWarmupFailure("highlighterMs", err));
}
