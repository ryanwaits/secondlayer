import { IndexHttpClient } from "@secondlayer/shared/index-http";

/**
 * Internal Index/Streams HTTP client for L2 decoders that source chain data over
 * the public data plane (api:3800) instead of tapping the indexer Postgres.
 * Same env contract as the subgraph runtime's buildHttpClient so a single deploy
 * config covers both. This is what lets the decoder run with no source-DB
 * coupling.
 */
export function createInternalIndexClient(): IndexHttpClient {
	const baseUrl =
		process.env.SUBGRAPH_INDEX_API_URL ??
		process.env.STREAMS_API_URL ??
		"http://api:3800";
	return new IndexHttpClient({
		indexBaseUrl: baseUrl,
		streamsBaseUrl: baseUrl,
		streamsApiKey:
			process.env.STREAMS_INTERNAL_API_KEY ?? "sk-sl_streams_decode_internal",
	});
}
