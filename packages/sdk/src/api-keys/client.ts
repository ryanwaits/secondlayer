import { BaseClient, type SecondLayerOptions } from "../base.ts";

/**
 * Typed client for the agent-reachable key mint (`POST /v1/api-keys`).
 *
 * Lets a headless agent self-provision a SCOPED `streams`/`index` read key
 * without the dashboard. Requires an owner credential — an account-level API
 * key (or a dashboard session). The minted key is always scoped (never an
 * account/superkey) and inherits the account plan's tier.
 */

/** Scope of a minted read key. */
export type ScopedKeyProduct = "streams" | "index";

export interface CreateApiKeyParams {
	/** Scope of the minted key. Defaults to "streams". */
	product?: ScopedKeyProduct;
	/** Optional human-readable label for the key. */
	name?: string;
}

export interface CreateApiKeyResponse {
	/** Plaintext key — returned ONCE. Store it now; only its hash is persisted. */
	key: string;
	prefix: string;
	id: string;
	product: string;
	tier: string | null;
	createdAt: string;
}

/** A key as seen by {@link ApiKeys.list} — metadata only, never the plaintext. */
export interface ApiKeySummary {
	id: string;
	prefix: string;
	name: string | null;
	status: "active" | "revoked";
	product: string;
	tier: string | null;
	createdAt: string;
	lastUsedAt: string | null;
}

export class ApiKeys extends BaseClient {
	constructor(options: Partial<SecondLayerOptions> = {}) {
		super(options);
	}

	/**
	 * Mint a new scoped read key. The configured `apiKey` must be an
	 * account-level (owner) key; the plaintext `key` in the response is shown
	 * only once.
	 */
	create(params: CreateApiKeyParams = {}): Promise<CreateApiKeyResponse> {
		return this.request<CreateApiKeyResponse>("POST", "/v1/api-keys", {
			product: params.product,
			name: params.name,
		});
	}

	/**
	 * List the account's keys (metadata only — no plaintext). Requires an
	 * account-level (owner) key or a dashboard session.
	 */
	list(): Promise<{ keys: ApiKeySummary[] }> {
		return this.request<{ keys: ApiKeySummary[] }>("GET", "/api/keys");
	}

	/** Revoke a key by id. Existing requests with that key stop working. */
	revoke(id: string): Promise<{ revoked: true; id: string }> {
		return this.request<{ revoked: true; id: string }>(
			"DELETE",
			`/api/keys/${id}`,
		);
	}
}
