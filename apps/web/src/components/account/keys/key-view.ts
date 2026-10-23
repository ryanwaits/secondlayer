import { shortDate } from "@/lib/rows";
import type { ApiKey, ApiKeyProduct } from "@/lib/types";
import { formatRelative } from "@/lib/webhooks-data";

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

/** Why a key you didn't make exists, in one line. */
export function keyWhy(product: ApiKeyProduct): string {
	switch (product) {
		case "docs":
			return "Signs the code samples in the docs while you're signed in. Read-only, renews itself every 24h.";
		case "tenant":
			return "Your hosted stack reads the chain with it. Revoking it would stop your webhooks.";
		case "sentinel":
			return "Sentinel reads your contracts' history with it. Sentinel bills separately.";
		default:
			return "";
	}
}

/** "3h ago", or null when the key has never been used. */
export function agoLong(iso: string | null, now: Date): string | null {
	return iso ? formatRelative(iso, now.getTime()) : null;
}

/** "3h", or an en dash when the key has never been used. */
export function agoShort(iso: string | null, now: Date): string {
	return agoLong(iso, now)?.replace(" ago", "") ?? "–";
}

/** The keys the summaries count: the ones you made, not a docs key that
 *  renews itself. Revoked and expired keys are already out. */
export function countedKeys(keys: ApiKey[] | null, now: Date): ApiKey[] {
	return groupKeys(keys, now).own.filter((k) => k.product !== "docs");
}

/** "Oct 13" for each of the last `count` UTC days, ending with `now`'s day. */
export function dayLabels(now: Date, count = 30): string[] {
	const day = 86_400_000;
	return Array.from({ length: count }, (_, i) =>
		shortDate(
			new Date(now.getTime() - (count - 1 - i) * day)
				.toISOString()
				.slice(0, 10),
		),
	);
}

/** The user's own keys that were revoked (docs keys never count). */
export function revokedOwnKeys(keys: ApiKey[] | null): ApiKey[] {
	return (keys ?? []).filter(
		(k) =>
			isOwnKey(k.product) && k.product !== "docs" && k.status === "revoked",
	);
}
