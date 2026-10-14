/**
 * Whether a request came from this site's own pages. A route that mints a
 * credential must refuse anything else: the session cookie rides along on a
 * cross-site POST, so the cookie alone proves nothing about who asked.
 *
 * `Origin` is required (a browser sends it on every POST, a script cannot
 * forge it), must match the host the request was addressed to, and a browser
 * that reports `Sec-Fetch-Site` must say `same-origin`.
 */
export function isSameOrigin(req: Request): boolean {
	const origin = req.headers.get("origin");
	if (!origin) return false;
	const site = req.headers.get("sec-fetch-site");
	if (site && site !== "same-origin") return false;
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return false;
	const host =
		req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
	return host !== "" && url.host === host.split(",")[0]?.trim();
}
