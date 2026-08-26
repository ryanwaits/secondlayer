// Internal service credentials for first-party consumers of /v1/index and
// /v1/streams over HTTP (decoder, subgraph processor PublicApiBlockSource).
// Seeded as internal tenants with NO account_id, so these reads are
// unmetered (metering gates on account_id). Lives in shared so the API (seed)
// and the consumers import it without a cycle.
//
// Resolution: STREAMS_INTERNAL_API_KEY / INDEX_INTERNAL_API_KEY, then
// INSTANCE_TOKEN (OSS). No committed fallback. Empty-string env values fall
// through (`trim()`, then empty): compose interpolates
// `${STREAMS_INTERNAL_API_KEY:-}` which is "" when unset.
//
// Archive keys must not use the `sk-sl_` prefix; generate with `sl-int_`.
// OSS compose should omit the internal env and send INSTANCE_TOKEN.
export const INDEX_INTERNAL_TENANT_ID = "tenant_index_internal";
export const INTERNAL_STREAMS_TENANT_ID = "tenant_streams_decode_internal";

const DEFAULT_INTERNAL_INDEX_BASE_URL = "http://api:3800";

const MISSING_INTERNAL_STREAMS_API_KEY =
	"Set STREAMS_INTERNAL_API_KEY (archive; prefix sl-int_) or INSTANCE_TOKEN (OSS). Empty env no longer falls back to a committed secret.";

export function defaultInternalIndexApiKey(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const internal = env.INDEX_INTERNAL_API_KEY?.trim();
	if (internal) return internal;
	const instance = env.INSTANCE_TOKEN?.trim();
	if (instance) return instance;
	return undefined;
}

export function defaultInternalStreamsApiKey(
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const internal = env.STREAMS_INTERNAL_API_KEY?.trim();
	if (internal) return internal;
	const instance = env.INSTANCE_TOKEN?.trim();
	if (instance) return instance;
	return undefined;
}

/** Decoder startup: refuse to run with neither credential. */
export function requireInternalStreamsApiKey(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const key = defaultInternalStreamsApiKey(env);
	if (!key) throw new Error(MISSING_INTERNAL_STREAMS_API_KEY);
	return key;
}

/** Shared env contract for decoder + subgraph HTTP dogfood. */
export function defaultInternalIndexBaseUrl(): string {
	return (
		process.env.SUBGRAPH_INDEX_API_URL ||
		process.env.STREAMS_API_URL ||
		DEFAULT_INTERNAL_INDEX_BASE_URL
	);
}
