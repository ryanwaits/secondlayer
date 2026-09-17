export interface Account {
	id: string;
	email: string;
	displayName: string | null;
	bio: string | null;
	avatarUrl: string | null;
	createdAt: string;
}

export type ApiKeyProduct = "account" | "streams" | "index";
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
}
