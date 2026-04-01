import type { ApiKey } from "@/lib/types";

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function detectStaleKeys(keys: ApiKey[]): ApiKey[] {
	const now = Date.now();
	return keys.filter((key) => {
		if (key.status !== "active") return false;
		if (!key.lastUsedAt) {
			return now - new Date(key.createdAt).getTime() > STALE_THRESHOLD_MS;
		}
		return now - new Date(key.lastUsedAt).getTime() > STALE_THRESHOLD_MS;
	});
}
