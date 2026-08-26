// Internal service credentials for first-party consumers of /v1/index and
// /v1/streams over HTTP (decoder, subgraph processor PublicApiBlockSource).
// Seeded as enterprise tenants with NO account_id, so these reads are
// unmetered (metering gates on account_id). Lives in shared so the API (seed)
// and the consumers import it without a cycle.
//
// Empty-string env values fall through (`||`, not `??`): compose interpolates
// `${STREAMS_INTERNAL_API_KEY:-}` which is "" when unset.
export const INDEX_INTERNAL_TENANT_ID = "tenant_index_internal";
export const INTERNAL_STREAMS_TENANT_ID = "tenant_streams_decode_internal";

const DEFAULT_INDEX_INTERNAL_API_KEY = "sk-sl_index_internal";
const DEFAULT_INTERNAL_STREAMS_API_KEY = "sk-sl_streams_decode_internal";
const DEFAULT_INTERNAL_INDEX_BASE_URL = "http://api:3800";

export function defaultInternalIndexApiKey(): string {
	return process.env.INDEX_INTERNAL_API_KEY || DEFAULT_INDEX_INTERNAL_API_KEY;
}

export function defaultInternalStreamsApiKey(): string {
	return (
		process.env.STREAMS_INTERNAL_API_KEY || DEFAULT_INTERNAL_STREAMS_API_KEY
	);
}

/** Shared env contract for decoder + subgraph HTTP dogfood. */
export function defaultInternalIndexBaseUrl(): string {
	return (
		process.env.SUBGRAPH_INDEX_API_URL ||
		process.env.STREAMS_API_URL ||
		DEFAULT_INTERNAL_INDEX_BASE_URL
	);
}
