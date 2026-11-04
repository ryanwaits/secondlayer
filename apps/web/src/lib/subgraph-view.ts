import type { Tone } from "@/lib/tone";

/** Pure view helpers for the Subgraphs screens: counts, lag and state lines. */

/** Group a digit string without ever going through `Number`: values can
 *  exceed 2^53. */
export function groupDigits(digits: string): string {
	const match = /^(-?)(\d+)$/.exec(digits);
	if (!match) return digits;
	return `${match[1]}${(match[2] ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** The week of hourly health the list and the detail's default range draw. */
export const HEALTH_WEEK_HOURS = 168;

/** Counts as live when the subgraph is under two blocks behind the tip. */
export const isLive = (blocksBehind: number): boolean => blocksBehind < 2;

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export const blocksLabel = (n: number): string => plural(n, "block");

/** "413k", "1.2M": compact counts for table tabs. */
export function shortCount(n: number): string {
	if (n < 1_000) return String(n);
	if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
	return `${+(n / 1_000_000).toFixed(1)}M`;
}

/** "1.2 GB", "340 MB": storage as a person reads it. */
export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let i = 0;
	while (value >= 1000 && i < units.length - 1) {
		value /= 1000;
		i++;
	}
	return `${i === 0 ? value : +value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/** Handler errors in the last 24 hours: the sum of the newest 24 hourly
 *  buckets from `/health`. The one definition both screens, the row tone
 *  and the sentence use; null until health has loaded. */
export function handlerErrors24h(
	health: { hours: readonly { errors: number }[] } | undefined,
): number | null {
	if (!health) return null;
	return health.hours.slice(-24).reduce((sum, h) => sum + h.errors, 0);
}

/** Failing for an errored subgraph or any handler error in 24 hours, neutral
 *  while it is not active (reindexing, stopped), else healthy. */
export function subgraphTone(status: string, errors24h: number | null): Tone {
	if (status === "error" || (errors24h ?? 0) > 0) return "alarm";
	return status === "active" ? "ok" : "idle";
}

/** The list row's state line: lag, rows and, when known, errors in 24 hours. */
export function stateLine(
	blocksBehind: number,
	rows: number,
	errors24h: number | null,
	status = "active",
): string {
	const lag =
		status === "reindexing"
			? `Reindexing · ${blocksLabel(blocksBehind)} left`
			: isLive(blocksBehind)
				? "At the tip"
				: `Behind tip ${blocksLabel(blocksBehind)}`;
	return [
		lag,
		plural(rows, "row").replace(/^\d+/, groupDigits(String(rows))),
		errors24h === null ? null : `${plural(errors24h, "error")} 24h`,
	]
		.filter(Boolean)
		.join(" · ");
}
