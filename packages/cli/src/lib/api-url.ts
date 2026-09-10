/**
 * Endpoint resolution with no other dependencies, so the session store can
 * key sessions by URL without importing the auth or HTTP layers.
 */

export const LOCAL_API_URL = "http://127.0.0.1:3800";
export const ARCHIVE_OPS_API_URL = "https://api.secondlayer.tools";

/**
 * Resolve the API endpoint. Independent of the credential: setting only
 * SECONDLAYER_API_URL (or the one-release SL_API_URL fallback) redirects the
 * endpoint while keeping the session token. Default is the local one-box API.
 */
export function resolveApiUrl(): string {
	return (
		process.env.SECONDLAYER_API_URL ??
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

/** True when `url` is our hosted merchant hostname (refuse-list for instance cmds). */
export function isMerchantUrl(url: string = resolveApiUrl()): boolean {
	try {
		return new URL(url).hostname === "api.secondlayer.tools";
	} catch {
		return false;
	}
}

/** Throw when the CLI is pointed at the merchant; instance commands refuse that host. */
export function assertInstanceUrl(url: string = resolveApiUrl()): void {
	if (!isMerchantUrl(url)) return;
	throw new Error(
		"this command runs on your instance, not api.secondlayer.tools.\nunset SECONDLAYER_API_URL, or pass --api-url http://127.0.0.1:3800",
	);
}
