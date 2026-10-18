export interface Account {
	id: string;
	email: string;
	displayName: string | null;
	bio: string | null;
	avatarUrl: string | null;
	createdAt: string;
}

export type ApiKeyProduct =
	| "account"
	| "streams"
	| "index"
	| "docs"
	| "sentinel"
	| "tenant";
export type ApiKeyTier = "free";

export interface ApiKey {
	id: string;
	prefix: string;
	name: string;
	status: string;
	product: ApiKeyProduct;
	tier: ApiKeyTier | null;
	createdAt: string;
	lastUsedAt: string | null;
	/** Set on a docs key: when it stops working. */
	expiresAt?: string | null;
	/** Rows delivered with this key in the last 30 days; absent from older API builds. */
	rows30d?: number;
	/** Rows delivered per UTC day over the last 30 days, oldest first; absent from older API builds. */
	rowsDaily?: number[];
}

/** An app signed in to the hosted MCP with OAuth, from `GET /api/oauth/grants`. */
export interface ConnectedApp {
	id: string;
	/** The name the app registered itself with: its own claim, unverified. */
	clientName: string;
	createdAt: string;
	lastUsedAt: string | null;
}

/** One top-up or grant from `GET /api/billing/credits`. Mirrors `CreditAdded`
 *  in `packages/platform/src/db/queries/usage-ledger.ts`. */
export interface CreditAdded {
	occurredAt: string;
	kind: "topup" | "grant";
	source: string;
	/** Positive amount credited, USD-micros. */
	usdMicros: string;
}
