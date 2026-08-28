/**
 * Endpoint resolution with no other dependencies, so the session store can
 * key sessions by URL without importing the auth or HTTP layers.
 */

export const LOCAL_API_URL = "http://127.0.0.1:3800";
export const ARCHIVE_OPS_API_URL = "https://api.secondlayer.tools";

/**
 * Resolve the API endpoint. Independent of the credential: setting only
 * SL_API_URL redirects the endpoint while keeping the session token.
 * Default is the local one-box API.
 */
export function resolveApiUrl(): string {
	return (
		process.env.SL_API_URL ??
		process.env.SL_PLATFORM_API_URL ??
		LOCAL_API_URL
	).replace(/\/+$/, "");
}

/** Merchant API that sells archive credits. Not the operator's loopback box. */
export function resolveArchiveOpsUrl(): string {
	return (process.env.SL_CREDITS_API_URL ?? ARCHIVE_OPS_API_URL).replace(
		/\/+$/,
		"",
	);
}
