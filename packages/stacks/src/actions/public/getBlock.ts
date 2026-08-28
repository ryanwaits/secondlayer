import type { Client } from "../../clients/types.ts";

export type GetBlockParams = {
	height?: number;
	hash?: string;
};

/**
 * Fetch one block by hash or height, or the chain tip when both are omitted.
 * Every path resolves to a single block object: the tip read unwraps the
 * list envelope the extended API returns for `?limit=1`.
 */
export async function getBlock(
	client: Client,
	params?: GetBlockParams,
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
): Promise<any> {
	if (params?.hash) {
		return client.request(
			`/extended/v2/blocks/${encodeURIComponent(params.hash)}`,
			{ method: "GET" },
		);
	}
	if (params?.height !== undefined) {
		return client.request(
			`/extended/v2/blocks/${encodeURIComponent(String(params.height))}`,
			{ method: "GET" },
		);
	}
	const data = await client.request("/extended/v2/blocks?limit=1", {
		method: "GET",
	});
	const results = (data as { results?: unknown[] } | null)?.results;
	return Array.isArray(results) ? (results[0] ?? null) : data;
}
