// Server-only: the bound on a page-blocking read from the platform API.

/** Warm reads answer in ~80 ms; this only trips on a hung upstream. */
export const UPSTREAM_READ_TIMEOUT_MS = 800;

export function upstreamPathShape(path: string): string {
	return (path.split("?")[0] ?? "").replace(
		/^(\/api\/(?:webhooks|subgraphs)\/)[^/]+/,
		"$1:id",
	);
}

export function logIfTimeout(err: unknown, path: string): boolean {
	if (!(err instanceof Error) || err.name !== "TimeoutError") return false;
	console.warn(`upstream-timeout path=${upstreamPathShape(path)}`);
	return true;
}
