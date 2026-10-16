import { shortDate } from "@/lib/rows";
import { shortCount } from "@/lib/subgraph-view";
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
			return "Sentinel reads your contracts' history with it, billed per run.";
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

/** Stale keys, the longest unused first. */
export function staleKeys(
	keys: ApiKey[],
	now: Date,
): { key: ApiKey; days: number }[] {
	return keys
		.flatMap((key) => {
			const days = keyFlags(key, now).staleDays;
			return days === undefined ? [] : [{ key, days }];
		})
		.sort((a, b) => b.days - a.days);
}

/** The key read most recently, or null when none has been used. */
export function lastReadKey(keys: ApiKey[]): ApiKey | null {
	let best: ApiKey | null = null;
	for (const k of keys) {
		if (!k.lastUsedAt) continue;
		if (!best || Date.parse(k.lastUsedAt) > Date.parse(best.lastUsedAt ?? ""))
			best = k;
	}
	return best;
}

/** Rows read with these keys in 30 days; null when the API sent no counts. */
export function totalRows30d(keys: ApiKey[]): number | null {
	const counted = keys.filter((k) => k.rows30d !== undefined);
	if (counted.length === 0) return null;
	return counted.reduce((sum, k) => sum + (k.rows30d ?? 0), 0);
}

/** Rows per UTC day summed over the keys, last `points` days; null when no key has a series. */
export function sumDaily(keys: ApiKey[], points: number): number[] | null {
	const series = keys.flatMap((k) => (k.rowsDaily ? [k.rowsDaily] : []));
	if (series.length === 0) return null;
	const length = Math.max(...series.map((s) => s.length));
	const total = new Array<number>(length).fill(0);
	for (const s of series) {
		const offset = length - s.length;
		s.forEach((v, i) => {
			total[offset + i] = (total[offset + i] ?? 0) + v;
		});
	}
	return total.slice(-points);
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

const keysWord = (n: number) => (n === 1 ? "key" : "keys");

/** "a", "a and b", "a, b and 2 more". */
function nameList(names: string[]): string {
	if (names.length <= 2) return names.join(" and ");
	return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export interface KeysSentence {
	tone: "ok" | "hi" | "idle";
	text: string;
	sub?: string;
}

/** The Keys screen's one-line answer: are your keys in use, and which are not. */
export function keysSentence(keys: ApiKey[] | null, now: Date): KeysSentence {
	const counted = countedKeys(keys, now);
	if (counted.length === 0) {
		return {
			tone: "idle",
			text: "No keys yet.",
			sub: "A key lets the SDK, the CLI and your agents read your data. Make one per place it runs, so revoking one never breaks the others.",
		};
	}
	const stale = staleKeys(counted, now);
	if (stale.length === 0) {
		return {
			tone: "ok",
			text:
				counted.length === 1
					? "Your key is in use."
					: `All ${counted.length} keys in use.`,
		};
	}
	const inUse = counted.length - stale.length;
	const days = Math.min(...stale.map((s) => s.days));
	const total = totalRows30d(counted);
	const names = nameList(stale.map((s) => s.key.name));
	const verb = stale.length === 1 ? "hasn't" : "haven't";
	return {
		tone: "hi",
		text: `${inUse} ${keysWord(inUse)} in use.`,
		sub: [
			`${names} ${verb} read anything in ${days} days`,
			total === null
				? null
				: `${shortCount(total)} rows read with your keys in 30 days`,
		]
			.filter(Boolean)
			.join(" · "),
	};
}

export interface OverviewKeys {
	tone: "ok" | "hi";
	state: string;
	/** Rows per day, last 24 days; null when the API sent no series. */
	spark: number[] | null;
	count: string;
	age: string;
}

/** The Overview's `keys` row; null when the account has no keys of its own. */
export function overviewKeys(
	keys: ApiKey[] | null,
	now: Date,
): OverviewKeys | null {
	const counted = countedKeys(keys, now);
	if (counted.length === 0) return null;
	const last = lastReadKey(counted);
	const stale = staleKeys(counted, now)[0];
	const head = last
		? `${counted.length} ${keysWord(counted.length)} · ${last.name} read ${agoLong(last.lastUsedAt, now)}`
		: `${counted.length} ${keysWord(counted.length)} · none read yet`;
	return {
		tone: stale ? "hi" : "ok",
		state: stale
			? `${head} · ${stale.key.name} unused ${stale.days} days`
			: head,
		spark: sumDaily(counted, 24),
		count: String(counted.length),
		age: last ? agoShort(last.lastUsedAt, now) : "–",
	};
}

/** True when a key you can revoke has been unused 30+ days. The Keys tab
 *  shows the unused-key note only then, so a just-revoked key's note
 *  doesn't linger until the next insight check. */
export function hasStaleOwnKey(keys: ApiKey[] | null, now: Date): boolean {
	return groupKeys(keys, now).own.some(
		(k) => k.product !== "docs" && keyFlags(k, now).staleDays !== undefined,
	);
}
