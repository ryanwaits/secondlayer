import type { ApiKey, ApiKeyProduct } from "@/lib/types";

/** A key unused for this many days is flagged. */
export const STALE_AFTER_DAYS = 30;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** What a key is for, in the reader's words. */
export function keyForLabel(product: ApiKeyProduct): string {
	switch (product) {
		case "docs":
			return "Docs samples";
		case "tenant":
			return "Your hosted stack";
		case "sentinel":
			return "Sentinel";
		default:
			return "Your key";
	}
}

/** Keys made for the reader's own tools. The rest are made for them. */
export function isOwnKey(product: ApiKeyProduct): boolean {
	return product !== "tenant" && product !== "sentinel";
}

export interface KeyFlags {
	/** Whole days unused, 30 or more. Revocable keys only. */
	staleDays?: number;
	/** Hours until a docs key stops working. */
	expiresInHours?: number;
}

/** Unused for 30+ days (from the last use, else from creation), or a docs
 *  key's time left. Docs keys expire on their own, so they are never stale. */
export function keyFlags(key: ApiKey, now: Date): KeyFlags {
	if (key.product === "docs") {
		if (!key.expiresAt) return {};
		const left = Date.parse(key.expiresAt) - now.getTime();
		return left > 0
			? { expiresInHours: Math.max(1, Math.round(left / HOUR)) }
			: {};
	}
	if (!isOwnKey(key.product)) return {};
	const since = Date.parse(key.lastUsedAt ?? key.createdAt);
	const days = Math.floor((now.getTime() - since) / DAY);
	return days >= STALE_AFTER_DAYS ? { staleDays: days } : {};
}

/** Active keys in two groups: the reader's own (plus a live docs key), and
 *  the ones made for them. A revoked or expired key shows in neither. */
export function groupKeys(
	keys: ApiKey[] | null,
	now: Date,
): { own: ApiKey[]; madeForYou: ApiKey[] } {
	const active = (keys ?? []).filter((k) => k.status === "active");
	const live = (k: ApiKey) =>
		k.product !== "docs" ||
		(k.expiresAt != null && Date.parse(k.expiresAt) > now.getTime());
	return {
		own: active.filter((k) => isOwnKey(k.product) && live(k)),
		madeForYou: active.filter((k) => !isOwnKey(k.product)),
	};
}
