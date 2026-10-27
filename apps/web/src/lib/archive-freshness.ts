import { nextScheduledArchivePublish } from "@secondlayer/shared/archive/status";

/** What the Archive page says about how far the signed copy reaches. */
export interface ArchiveFreshnessData {
	toBlock: number;
	promotedAt: string;
	state: string;
	/** Next scheduled publish (UTC ISO); null until the status carries it. */
	nextPublishAt: string | null;
	/** Chain tip minus toBlock as the status last saw it. */
	behindTip: number | null;
}

const isNum = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";

/** Pull the figures out of a `status.json` body; null when the shape is unusable. */
export function readArchiveFreshness(
	body: unknown,
): ArchiveFreshnessData | null {
	const s = body as {
		state?: unknown;
		next_publish_at?: unknown;
		archive?: { coverage_to_block?: unknown; promoted_at?: unknown };
		lag?: { blocks_behind_tip?: unknown };
	} | null;
	const toBlock = s?.archive?.coverage_to_block;
	const promotedAt = s?.archive?.promoted_at;
	if (!isNum(toBlock) || !isStr(promotedAt) || !isStr(s?.state)) return null;
	const behind = s?.lag?.blocks_behind_tip;
	return {
		toBlock,
		promotedAt,
		state: s.state,
		nextPublishAt: isStr(s?.next_publish_at) ? s.next_publish_at : null,
		behindTip: isNum(behind) ? Math.max(0, behind) : null,
	};
}

/** The first scheduled run after the last promotion: the one that is overdue when stale. */
export function overdueSince(promotedAt: string): string {
	return nextScheduledArchivePublish(new Date(promotedAt)).toISOString();
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** "Oct 7", in UTC. */
export function formatDay(iso: string): string {
	const d = new Date(iso);
	return `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Sun Oct 18, 08:00 UTC", in UTC. */
export function formatPublishTime(iso: string): string {
	const d = new Date(iso);
	const hh = String(d.getUTCHours()).padStart(2, "0");
	const mm = String(d.getUTCMinutes()).padStart(2, "0");
	return `${WEEKDAY[d.getUTCDay()]} ${formatDay(iso)}, ${hh}:${mm} UTC`;
}

export type PartitionDataset = "blocks" | "transactions" | "events";
export type PartitionNames = Record<PartitionDataset, string>;

const DATASETS: readonly PartitionDataset[] = [
	"blocks",
	"transactions",
	"events",
];

/** Newest partition per dataset, named `from-to-sha4….parquet`; null unless all three exist. Other datasets are ignored. */
export function lastPartitions(snapshot: unknown): PartitionNames | null {
	const list = (snapshot as { partitions?: unknown } | null)?.partitions;
	if (!Array.isArray(list)) return null;
	const best = new Map<
		PartitionDataset,
		{ from: number; to: number; sha: string }
	>();
	for (const p of list) {
		const dataset = p?.dataset as PartitionDataset;
		if (!DATASETS.includes(dataset)) continue;
		if (!isNum(p.from_block) || !isNum(p.to_block) || !isStr(p.sha256))
			continue;
		const cur = best.get(dataset);
		if (!cur || p.to_block > cur.to)
			best.set(dataset, { from: p.from_block, to: p.to_block, sha: p.sha256 });
	}
	const out: Partial<PartitionNames> = {};
	for (const d of DATASETS) {
		const b = best.get(d);
		if (!b) return null;
		out[d] = `${b.from}-${b.to}-${b.sha.slice(0, 4)}….parquet`;
	}
	return out as PartitionNames;
}
