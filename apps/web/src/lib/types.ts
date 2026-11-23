export interface Account {
	id: string;
	email: string | null;
	displayName: string | null;
	bio: string | null;
	avatarUrl: string | null;
	createdAt: string;
	internal?: boolean;
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
	expiresAt?: string | null;
	rows30d?: number;
	rowsDaily?: number[];
}

export interface ConnectedApp {
	id: string;
	/** The name the app registered itself with: its own claim, unverified. */
	clientName: string;
	createdAt: string;
	lastUsedAt: string | null;
}

/** Mirrors `CreditAdded` in `packages/platform/src/db/queries/usage-ledger.ts`. */
export interface CreditAdded {
	occurredAt: string;
	kind: "topup" | "grant";
	source: string;
	usdMicros: string;
}
