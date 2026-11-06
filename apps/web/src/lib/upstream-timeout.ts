// Server-only: the bound on a page-blocking read from the platform API.

/** How long a server read waits for the API before the page goes without it.
 *  Warm reads answer in ~80 ms; this only trips on a hung upstream. */
export const UPSTREAM_READ_TIMEOUT_MS = 800;

/** A path with its ids dropped, for logs: `/api/webhooks/abc?x=1` becomes
 *  `/api/webhooks/:id`. */
export function upstreamPathShape(path: string): string {
	return (path.split("?")[0] ?? "").replace(
		/^(\/api\/(?:webhooks|subgraphs)\/)[^/]+/,
		"$1:id",
	);
}

/** Logs a timed-out read; returns false for any other failure. */
export function logIfTimeout(err: unknown, path: string): boolean {
	if (!(err instanceof Error) || err.name !== "TimeoutError") return false;
	console.warn(`upstream-timeout path=${upstreamPathShape(path)}`);
	return true;
}
