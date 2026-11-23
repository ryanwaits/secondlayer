import type { Tone } from "@/lib/tone";
import { type SubgraphSyncState, syncState } from "@secondlayer/shared/schemas";

/** Group a digit string without ever going through `Number`: values can
 *  exceed 2^53. */
export function groupDigits(digits: string): string {
	const match = /^(-?)(\d+)$/.exec(digits);
	if (!match) return digits;
	return `${match[1]}${(match[2] ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export const HEALTH_WEEK_HOURS = 168;

/** A subgraph one block behind is at the tip: the chain moves on every few
 *  seconds, so "caught up" can't mean exactly equal. */
const TIP_SLACK_BLOCKS = 1;

export function subgraphSync(
	item: {
		status: string;
		lastProcessedBlock: number;
		blocksRemaining?: number | null;
	},
	chainTip?: number,
): SubgraphSyncState {
	const tip = chainTip ?? item.lastProcessedBlock + (item.blocksRemaining ?? 0);
	return syncState(item, tip - TIP_SLACK_BLOCKS);
}

/** Uses the event counts when the operation has them, since the block share
 *  misleads on a sparse sync. */
export function syncPercent(sync: {
	blocksRemaining: number;
	progress?: number;
	processedEvents?: number;
	estimatedEvents?: number;
}): number | null {
	const { processedEvents, estimatedEvents } = sync;
	const share =
		processedEvents !== undefined && estimatedEvents
			? processedEvents / estimatedEvents
			: sync.progress;
	if (share === undefined || !Number.isFinite(share)) return null;
	const percent = Math.floor(Math.min(1, Math.max(0, share)) * 100);
	return sync.blocksRemaining > 0 ? Math.min(99, percent) : percent;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export const blocksLabel = (n: number): string => plural(n, "block");

export function shortCount(n: number): string {
	if (n < 1_000) return String(n);
	if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
	return `${+(n / 1_000_000).toFixed(1)}M`;
}

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

export function handlerErrors24h(
	health: { hours: readonly { errors: number }[] } | undefined,
): number | null {
	if (!health) return null;
	return health.hours.slice(-24).reduce((sum, h) => sum + h.errors, 0);
}

export function haltLine(item: {
	status: string;
	lastError?: string | null;
}): string | null {
	if (item.status !== "error") return null;
	const reason = item.lastError?.trim().replace(/\.+$/, "");
	if (!reason) return "Halted. Redeploy or reindex to resume.";
	return /redeploy|reindex/i.test(reason)
		? reason
		: `${reason}. Redeploy or reindex to resume.`;
}

export function subgraphTone(status: string, errors24h: number | null): Tone {
	if (status === "error" || (errors24h ?? 0) > 0) return "alarm";
	return status === "active" ? "ok" : "idle";
}

export function stateLine(
	sync: SubgraphSyncState,
	blocksBehind: number,
	rows: number,
	errors24h: number | null,
): string {
	const lag =
		sync === "reindexing"
			? `Reindexing · ${blocksLabel(blocksBehind)} left`
			: sync === "catching_up"
				? `Behind tip ${blocksLabel(blocksBehind)}`
				: "At the tip";
	return [
		lag,
		plural(rows, "row").replace(/^\d+/, groupDigits(String(rows))),
		errors24h === null ? null : `${plural(errors24h, "error")} 24h`,
	]
		.filter(Boolean)
		.join(" · ");
}
