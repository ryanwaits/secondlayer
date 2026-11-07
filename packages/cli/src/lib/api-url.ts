/**
 * Endpoint resolution, kept free of the auth and HTTP layers so the session
 * store can key sessions by URL. Host detection comes from the SDK so the CLI
 * and SDK agree on what "hosted" means.
 */

import {
	isHostedApiUrl,
	resolveAccountUrl,
	resolveBaseUrl,
} from "@secondlayer/sdk";

export const LOCAL_API_URL = "http://127.0.0.1:3800";
export const ARCHIVE_OPS_API_URL = "https://api.secondlayer.tools";

/**
 * Resolve the API endpoint by the SDK's rule, so both agree. Setting only
 * SECONDLAYER_API_URL redirects the endpoint while keeping the session token.
 * A lone account key selects the hosted API; otherwise the local one-box API.
 */
export function resolveApiUrl(): string {
	return resolveBaseUrl();
}

/** Your hosted account's API (credits, archive fetches, login). Not the operator's loopback box. */
export function resolveArchiveOpsUrl(): string {
	return resolveAccountUrl();
}

/** True when `url` is our hosted merchant hostname (refuse-list for instance cmds). */
export function isMerchantUrl(url: string = resolveApiUrl()): boolean {
	return isHostedApiUrl(url);
}

/** Throw when the CLI is pointed at the merchant; instance commands refuse that host. */
export function assertInstanceUrl(url: string = resolveApiUrl()): void {
	if (!isMerchantUrl(url)) return;
	const fix = process.env.SECONDLAYER_API_URL
		? "unset SECONDLAYER_API_URL"
		: "set INSTANCE_TOKEN";
	throw new Error(
		`this command runs on your instance, not api.secondlayer.tools.\n${fix}, or pass --api-url http://127.0.0.1:3800`,
	);
}
