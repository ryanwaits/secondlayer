// Internal service credential for first-party consumers of /v1/index over HTTP
// (e.g. the subgraph processor's PublicApiBlockSource). Seeded into the Index
// token store as an enterprise tenant with NO account_id, so these reads are
// unmetered (Index metering gates on account_id). Mirrors the Streams internal
// key (packages/indexer/src/l2/internal-auth.ts). Lives in shared so both the
// API (seed) and the subgraph processor (consumer) import it without a cycle.
export const INDEX_INTERNAL_TENANT_ID = "tenant_index_internal";

const DEFAULT_INDEX_INTERNAL_API_KEY = "sk-sl_index_internal";

export function defaultInternalIndexApiKey(): string {
	return process.env.INDEX_INTERNAL_API_KEY || DEFAULT_INDEX_INTERNAL_API_KEY;
}
