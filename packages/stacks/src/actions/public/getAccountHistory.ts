import type { Client } from "../../clients/types.ts";

export type GetAccountHistoryParams = {
	address: string;
	/** Capped at 50. Default 20. */
	limit?: number;
};

export type AccountHistoryResponse = {
	results: unknown[];
	total: number;
};

/** Paginated transaction history for a principal (Hiro extended API). */
export async function getAccountHistory(
	client: Client,
	params: GetAccountHistoryParams,
): Promise<AccountHistoryResponse> {
	const limit = Math.min(params.limit ?? 20, 50);
	return client.request(
		`/extended/v2/addresses/${params.address}/transactions?limit=${limit}`,
		{ method: "GET" },
	);
}
