/**
 * Where the hosted MCP and its OAuth server say they live. The issuer and the
 * resource come from `API_PUBLIC_URL`, never from the request's Host: a
 * spoofed Host must not change what a client is told to trust.
 */

const DEFAULT_API_PUBLIC_URL = "https://api.secondlayer.tools";
const DEFAULT_WEB_URL = "https://secondlayer.tools";

const trimSlashes = (url: string) => url.replace(/\/+$/, "");

/** The API's public origin, e.g. `https://api.secondlayer.tools`. */
export function issuerOrigin(): string {
	return trimSlashes(
		process.env.API_PUBLIC_URL?.trim() || DEFAULT_API_PUBLIC_URL,
	);
}

/** The web app that hosts the consent page. */
export function consentWebUrl(): string {
	return trimSlashes(process.env.WEB_URL?.trim() || DEFAULT_WEB_URL);
}

/** The only resource tokens are issued for (RFC 8707). */
export const resourceOf = (origin: string) => `${origin}/mcp`;

export const resourceMetadataUrl = (origin: string) =>
	`${origin}/.well-known/oauth-protected-resource/mcp`;

/** The `WWW-Authenticate` value on a 401 from `/mcp` (RFC 9728 §5.1). */
export function mcpChallenge(origin: string, invalid = false): string {
	return `Bearer ${invalid ? 'error="invalid_token", ' : ""}resource_metadata="${resourceMetadataUrl(origin)}", scope="mcp"`;
}
