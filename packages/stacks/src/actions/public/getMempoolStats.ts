import type { Client } from "../../clients/types.ts";

/**
 * Current mempool statistics: pending count, fee distribution, age buckets
 * (Hiro extended API).
 */
export async function getMempoolStats(
	client: Client,
	// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
): Promise<any> {
	return client.request("/extended/v1/tx/mempool/stats", { method: "GET" });
}
