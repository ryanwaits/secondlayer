/** Derive the dashboard base URL from the API URL.
 *  - Strips a leading `api.` subdomain (api.secondlayer.tools → secondlayer.tools).
 *  - `SL_DASHBOARD_URL` env wins if set. */
export function deriveBaseUrl(apiUrl: string): string {
	const override = process.env.SL_DASHBOARD_URL?.trim();
	if (override) return override.replace(/\/$/, "");
	try {
		const url = new URL(apiUrl);
		url.hostname = url.hostname.replace(/^api\./, "");
		url.pathname = "/";
		return url.toString().replace(/\/$/, "");
	} catch {
		return apiUrl.replace(/\/$/, "");
	}
}
