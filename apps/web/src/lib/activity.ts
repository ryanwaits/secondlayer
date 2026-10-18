import type { ReplayProgress } from "@secondlayer/shared/schemas/webhooks";
import type { ChainState, ChainTip } from "./chain-tip";
import { replayPercent } from "./replays";

/** live, behind, stalled under 15 min, stalled 15 min or more, unreachable. */
export type ChainLevel = 0 | 1 | 2 | 3 | 4;

export const STALLED_SEVERE_MINUTES = 15;
const REPLAY_WINDOW_MS = 24 * 3600 * 1000;

export function chainLevel(s: ChainState): ChainLevel {
	switch (s.kind) {
		case "live":
			return 0;
		case "behind":
			return 1;
		case "stalled":
			return s.minutes >= STALLED_SEVERE_MINUTES ? 3 : 2;
		case "unreachable":
			return 4;
	}
}

export type Activity =
	| {
			kind: "chain";
			state: Exclude<ChainState, { kind: "live" }>;
			level: ChainLevel;
	  }
	| { kind: "replay"; progress: ReplayProgress };

export type ActivityDot = "bad" | "ring" | "run" | "ok";

function running(p: ReplayProgress): boolean {
	return p.status === "scanning" || p.status === "running";
}

function newestFirst(a: ReplayProgress, b: ReplayProgress): number {
	return Date.parse(b.startedAt) - Date.parse(a.startedAt);
}

/**
 * What the pill and the Activity drawer show, most urgent first: unreachable
 * chain, running or scanning replays (newest first), behind or stalled chain,
 * then done or failed replays not cleared and finished in the last 24 hours.
 * Chain items at or below `dismissedLevel` are left out.
 */
export function activities(input: {
	chain: ChainState;
	dismissedLevel: ChainLevel;
	replays: readonly ReplayProgress[];
	cleared: ReadonlySet<string>;
	now: number;
}): Activity[] {
	const { chain, dismissedLevel, replays, cleared, now } = input;
	const level = chainLevel(chain);
	const chainItem: Activity | null =
		chain.kind !== "live" && level > dismissedLevel
			? { kind: "chain", state: chain, level }
			: null;
	const live = replays.filter(running).sort(newestFirst);
	const finished = replays
		.filter((p) => {
			if (running(p) || cleared.has(p.replayId)) return false;
			const at = Date.parse(p.finishedAt ?? p.startedAt);
			return now - at <= REPLAY_WINDOW_MS;
		})
		.sort(newestFirst);
	const out: Activity[] = [];
	if (chainItem && level === 4) out.push(chainItem);
	for (const progress of live) out.push({ kind: "replay", progress });
	if (chainItem && level !== 4) out.push(chainItem);
	for (const progress of finished) out.push({ kind: "replay", progress });
	return out;
}

/** The pill's short label. */
export function pillLabel(a: Activity): string {
	if (a.kind === "chain") {
		switch (a.state.kind) {
			case "behind":
				return `${a.state.blocks} behind`;
			case "stalled":
				return `No blocks ${a.state.minutes}m`;
			case "unreachable":
				return "Offline";
		}
	}
	const p = (a as Extract<Activity, { kind: "replay" }>).progress;
	switch (p.status) {
		case "scanning":
			return "Replay queued";
		case "running":
			return `Replay ${replayPercent(p)}%`;
		case "done":
			return "Replay done";
		case "failed":
			return "Replay failed";
	}
}

/** The dot beside an item: red for unreachable and failed, a ring for other chain problems, a spinner while running, a check when done. */
export function activityDot(a: Activity): ActivityDot {
	if (a.kind === "chain") return a.level === 4 ? "bad" : "ring";
	switch (a.progress.status) {
		case "scanning":
		case "running":
			return "run";
		case "done":
			return "ok";
		case "failed":
			return "bad";
	}
}

/** A stable identity for an item, so React keeps its section across ticks. */
export function activityKey(a: Activity): string {
	return a.kind === "chain" ? "chain" : `replay:${a.progress.replayId}`;
}

/** The dismissal after the chain moves: going live clears it (0); otherwise it stays. */
export function nextDismissedLevel(
	prev: ChainLevel,
	s: ChainState,
): ChainLevel {
	return s.kind === "live" ? 0 : prev;
}

type ChainTrouble = Exclude<ChainState, { kind: "live" }>;

const fmt = (n: number) => n.toLocaleString("en-US");

/** The drawer title when this is the only item. */
export function chainHeadline(s: ChainTrouble): string {
	switch (s.kind) {
		case "behind":
			return `We're ${fmt(s.blocks)} blocks behind the chain`;
		case "stalled":
			return `Stacks hasn't made a block in ${s.minutes} min`;
		case "unreachable":
			return "Can't reach Secondlayer";
	}
}

/** The section heading when the drawer holds several items. */
export function chainLabel(s: ChainTrouble): string {
	switch (s.kind) {
		case "behind":
			return "Index behind";
		case "stalled":
			return "Chain stalled";
		case "unreachable":
			return "Unreachable";
	}
}

/** Key and value rows under a chain problem. */
export function chainRows(
	s: ChainTrouble,
	tip: ChainTip,
	now: number,
): Array<[string, string]> {
	if (s.kind === "unreachable") {
		return [
			["Retrying", "every 5 s"],
			["Your stack", "runs on our side either way"],
		];
	}
	if (s.kind === "behind") {
		return [
			["Chain tip", tip.nodeTip === null ? "unknown" : fmt(tip.nodeTip)],
			[
				"Our index",
				`${tip.height === null ? "unknown" : fmt(tip.height)} · ${fmt(s.blocks)} behind`,
			],
		];
	}
	const bitcoinAge =
		tip.bitcoinSeenAt === null
			? ""
			: ` · ${Math.max(0, Math.floor((now - tip.bitcoinSeenAt) / 60_000))} min ago`;
	return [
		[
			"Last Stacks block",
			`${tip.height === null ? "unknown" : fmt(tip.height)} · ${s.minutes} min ago`,
		],
		[
			"Last Bitcoin block",
			tip.bitcoin === null ? "unknown" : `${fmt(tip.bitcoin)}${bitcoinAge}`,
		],
		["Our index", "at the tip"],
	];
}

/** The paragraph under the rows. */
export function chainBody(s: ChainTrouble): string {
	switch (s.kind) {
		case "stalled":
			return "Stacks waits on its signers to make blocks. Webhooks and subgraphs pick up the next block the moment it lands. Nothing is lost.";
		case "behind":
			return "Webhooks and subgraphs deliver in order once we catch up. Nothing is skipped.";
		case "unreachable":
			return "This is the connection between your phone and us. Deliveries and subgraphs keep running on our side.";
	}
}

/** The hint under Dismiss. */
export function dismissHint(s: ChainTrouble): string {
	return s.kind === "unreachable"
		? "Hidden until it clears."
		: "Comes back if it gets worse.";
}
