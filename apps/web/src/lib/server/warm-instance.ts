// Server-only: pulls in undici and the highlighter.
import { PLATFORM_API_URL } from "@/lib/api";
import { upstreamAgent } from "@/lib/upstream-agent";
import type { Agent } from "undici";

/**
 * Starts the work a new instance's first request would otherwise pay for:
 * loading the highlighter's grammars and themes, and opening the keep-alive
 * connection to the API. Returns at once; both run in the background and a
 * failure just means that request pays as it did before.
 */
export function warmInstance(): void {
	void import("@/components/code/code")
		.then(({ renderCode }) =>
			renderCode({ code: "const warm = 1;", lang: "ts" }),
		)
		.catch(() => {});
	void fetch(`${PLATFORM_API_URL}/health`, {
		cache: "no-store",
		dispatcher: upstreamAgent,
	} as RequestInit & { dispatcher: Agent })
		.then((res) => res.body?.cancel())
		.catch(() => {});
}
