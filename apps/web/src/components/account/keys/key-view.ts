import { shortDate } from "@/lib/rows";
import { shortCount } from "@/lib/subgraph-view";
import type { ApiKey, ApiKeyProduct } from "@/lib/types";
import { formatRelative } from "@/lib/webhooks-data";

export const STALE_AFTER_DAYS = 30;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function opensNewKeyFlow(params: {
	new?: string | string[];
}): boolean {
	return params.new === "1";
}

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

export function isOwnKey(product: ApiKeyProduct): boolean {
	return product !== "tenant" && product !== "sentinel";
}

export interface KeyFlags {
	staleDays?: number;
	expiresInHours?: number;
}

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

export function agoLong(iso: string | null, now: Date): string | null {
	return iso ? formatRelative(iso, now.getTime()) : null;
}

export function agoShort(iso: string | null, now: Date): string {
	return agoLong(iso, now)?.replace(" ago", "") ?? "–";
}

export function countedKeys(keys: ApiKey[] | null, now: Date): ApiKey[] {
	return groupKeys(keys, now).own.filter((k) => k.product !== "docs");
}

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

export function lastReadKey(keys: ApiKey[]): ApiKey | null {
	let best: ApiKey | null = null;
	for (const k of keys) {
		if (!k.lastUsedAt) continue;
		if (!best || Date.parse(k.lastUsedAt) > Date.parse(best.lastUsedAt ?? ""))
			best = k;
	}
	return best;
}

export function totalRows30d(keys: ApiKey[]): number | null {
	const counted = keys.filter((k) => k.rows30d !== undefined);
	if (counted.length === 0) return null;
	return counted.reduce((sum, k) => sum + (k.rows30d ?? 0), 0);
}

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

function nameList(names: string[]): string {
	if (names.length <= 2) return names.join(" and ");
	return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

export interface KeysSentence {
	text: string;
	sub?: string;
}

export function revokedOwnKeys(keys: ApiKey[] | null): ApiKey[] {
	return (keys ?? []).filter(
		(k) =>
			isOwnKey(k.product) && k.product !== "docs" && k.status === "revoked",
	);
}

export function keysSentence(
	keys: ApiKey[] | null,
	now: Date,
	opts: { revokedInUse?: boolean } = {},
): KeysSentence {
	const counted = countedKeys(keys, now);
	if (counted.length === 0) {
		const revoked = revokedOwnKeys(keys).length;
		if (revoked === 0) {
			return {
				text: "No keys yet.",
				sub: "A key lets the SDK, the CLI and plain HTTP calls read your data. Make one per place it runs, so revoking one never breaks the others.",
			};
		}
		if (opts.revokedInUse) {
			return {
				text: "No active keys, and one is still called.",
				sub: "Something still reads with a key you revoked, and every call it makes fails. Swap an active key in where the old one lives.",
			};
		}
		return {
			text: "No active keys.",
			sub: `${revoked === 1 ? "You revoked your only key." : `You revoked all ${revoked}.`} Reads need a new key; anything still calling with an old one gets a 401. Webhooks and subgraphs don't use keys and keep running.`,
		};
	}
	const stale = staleKeys(counted, now);
	if (stale.length === 0) {
		return {
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
	spark: number[] | null;
	count: string;
	age: string;
}

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
