import type { Client } from "../../clients/types.ts";

export type GetNftHoldingsParams = {
	address: string;
	/** Capped at 50. Default 20. */
	limit?: number;
};

export type NftHoldingsResponse = {
	results: unknown[];
	total: number;
};

/** NFT holdings for a principal across all collections (Hiro extended API). */
export async function getNftHoldings(
	client: Client,
	params: GetNftHoldingsParams,
): Promise<NftHoldingsResponse> {
	const limit = Math.min(params.limit ?? 20, 50);
	return client.request(
		`/extended/v1/tokens/nft/holdings?principal=${encodeURIComponent(params.address)}&limit=${limit}`,
		{ method: "GET" },
	);
}
