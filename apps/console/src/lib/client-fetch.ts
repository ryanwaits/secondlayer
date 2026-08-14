/**
 * Client-side fetch against the console's own proxy routes.
 *
 * The app serves under `basePath: "/console"`. Next only auto-prefixes
 * <Link>/router navigations — a raw `fetch("/api/…")` would escape the base
 * path and miss the proxy handlers, so every client fetch goes through here.
 * This is the one place the base path is spelled out.
 */

const BASE_PATH = "/console";

export function consoleFetch(
	path: string,
	init?: RequestInit,
): Promise<Response> {
	return fetch(`${BASE_PATH}${path}`, {
		credentials: "same-origin",
		...init,
	});
}
