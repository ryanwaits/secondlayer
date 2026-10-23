import { describe, expect, test } from "bun:test";
import type { ReplayProgress } from "@secondlayer/shared/schemas/webhooks";
import {
	type Activity,
	activities,
	activityDot,
	chainBody,
	chainHeadline,
	chainLabel,
	chainLevel,
	chainRows,
	dismissHint,
	nextDismissedLevel,
	pillLabel,
} from "./activity";
import { type ChainState, EMPTY_TIP } from "./chain-tip";

const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const HOUR = 3600 * 1000;

const live: ChainState = { kind: "live" };
type Trouble = Exclude<ChainState, { kind: "live" }>;
const stalled = (minutes: number): Trouble => ({
	kind: "stalled",
	minutes,
	bitcoinSince: null,
});
const behind: Trouble = { kind: "behind", blocks: 18 };
const unreachable: Trouble = { kind: "unreachable" };

function replay(patch: Partial<ReplayProgress>): ReplayProgress {
	return {
		replayId: "0123456789abcdef",
		webhookId: "wh_1",
		status: "running",
		fromBlock: 100,
		toBlock: 200,
		total: 3812,
		processed: 1452,
		pending: 2360,
		delivered: null,
		gaveUp: null,
		startedAt: new Date(NOW - HOUR).toISOString(),
		finishedAt: null,
		error: null,
		...patch,
	};
}

const done = (id: string, finishedAgoMs: number): ReplayProgress =>
	replay({
		replayId: id,
		status: "done",
		processed: 3812,
		pending: 0,
		delivered: 3790,
		gaveUp: 22,
		finishedAt: new Date(NOW - finishedAgoMs).toISOString(),
	});

function list(
	chain: ChainState,
	replays: ReplayProgress[],
	extra: {
		dismissedLevel?: 0 | 1 | 2 | 3 | 4;
		cleared?: string[];
		requeuing?: string[];
	} = {},
): Activity[] {
	return activities({
		chain,
		dismissedLevel: extra.dismissedLevel ?? 0,
		replays,
		cleared: new Set(extra.cleared ?? []),
		now: NOW,
		requeuing: extra.requeuing,
	});
}

const kinds = (items: Activity[]) =>
	items.map((a) =>
		a.kind === "chain"
			? `chain:${a.state.kind}`
			: a.kind === "requeue"
				? `requeue:${a.webhookId}`
				: `replay:${a.progress.replayId}`,
	);

describe("chainLevel", () => {
	test("ranks the chain states", () => {
		expect(chainLevel(live)).toBe(0);
		expect(chainLevel(behind)).toBe(1);
		expect(chainLevel(stalled(14))).toBe(2);
		expect(chainLevel(stalled(15))).toBe(3);
		expect(chainLevel(unreachable)).toBe(4);
	});
});

describe("activities ordering", () => {
	test("a requeue in flight shows as Requeuing with a spinner, before a replay", () => {
		const items = list(live, [replay({ replayId: "a" })], {
			requeuing: ["wh_1"],
		});
		expect(kinds(items)).toEqual(["requeue:wh_1", "replay:a"]);
		const [first] = items;
		if (!first) throw new Error("expected an item");
		expect(pillLabel(first)).toBe("Requeuing");
		expect(activityDot(first)).toBe("run");
	});
	test("an unreachable chain comes before a running replay", () => {
		expect(kinds(list(unreachable, [replay({ replayId: "a" })]))).toEqual([
			"chain:unreachable",
			"replay:a",
		]);
	});
	test("a running replay comes before a stalled chain", () => {
		expect(kinds(list(stalled(4), [replay({ replayId: "a" })]))).toEqual([
			"replay:a",
			"chain:stalled",
		]);
	});
	test("a stalled chain comes before a done replay", () => {
		expect(kinds(list(stalled(4), [done("d", HOUR)]))).toEqual([
			"chain:stalled",
			"replay:d",
		]);
	});
	test("two running replays go newest first", () => {
		const older = replay({
			replayId: "old",
			startedAt: new Date(NOW - 2 * HOUR).toISOString(),
		});
		const newer = replay({
			replayId: "new",
			startedAt: new Date(NOW - HOUR).toISOString(),
		});
		expect(kinds(list(live, [older, newer]))).toEqual([
			"replay:new",
			"replay:old",
		]);
	});
	test("nothing going on is empty", () => {
		expect(list(live, [])).toEqual([]);
	});
});

describe("dismissal and clearing", () => {
	test("dismissed at 2 hides a 4 minute stall and a behind chain", () => {
		expect(list(stalled(4), [], { dismissedLevel: 2 })).toEqual([]);
		expect(list(behind, [], { dismissedLevel: 2 })).toEqual([]);
	});
	test("dismissed at 2 shows a 17 minute stall", () => {
		expect(kinds(list(stalled(17), [], { dismissedLevel: 2 }))).toEqual([
			"chain:stalled",
		]);
	});
	test("going live resets the dismissal; other states keep it", () => {
		expect(nextDismissedLevel(3, live)).toBe(0);
		expect(nextDismissedLevel(3, stalled(20))).toBe(3);
	});
	test("a cleared done replay is left out", () => {
		expect(list(live, [done("d", HOUR)], { cleared: ["d"] })).toEqual([]);
	});
	test("a done replay finished 25 hours ago is left out", () => {
		expect(list(live, [done("d", 25 * HOUR)])).toEqual([]);
	});
});

describe("pillLabel", () => {
	const chain = (state: Trouble): Activity => ({
		kind: "chain",
		state,
		level: chainLevel(state),
	});
	const rep = (patch: Partial<ReplayProgress>): Activity => ({
		kind: "replay",
		progress: replay(patch),
	});
	test("chain states", () => {
		expect(pillLabel(chain(behind))).toBe("18 behind");
		expect(pillLabel(chain(stalled(4)))).toBe("No blocks 4m");
		expect(pillLabel(chain(unreachable))).toBe("Offline");
	});
	test("replay states", () => {
		expect(pillLabel(rep({ status: "scanning" }))).toBe("Replay queued");
		expect(pillLabel(rep({ status: "running" }))).toBe("Replay 38%");
		expect(pillLabel(rep({ status: "done" }))).toBe("Replay done");
		expect(pillLabel(rep({ status: "failed" }))).toBe("Replay failed");
	});
	test("dots", () => {
		expect(activityDot(chain(unreachable))).toBe("bad");
		expect(activityDot(chain(behind))).toBe("ring");
		expect(activityDot(rep({ status: "running" }))).toBe("run");
		expect(activityDot(rep({ status: "done" }))).toBe("ok");
		expect(activityDot(rep({ status: "failed" }))).toBe("bad");
	});
});

describe("chain drawer copy", () => {
	test("headlines and labels", () => {
		expect(chainHeadline(behind)).toBe("We're 18 blocks behind the chain");
		expect(chainHeadline(stalled(4))).toBe(
			"Stacks hasn't made a block in 4 min",
		);
		expect(chainHeadline(unreachable)).toBe("Can't reach Secondlayer");
		expect(chainLabel(behind)).toBe("Index behind");
		expect(chainLabel(stalled(4))).toBe("Chain stalled");
		expect(chainLabel(unreachable)).toBe("Unreachable");
	});

	test("rows read from the tip", () => {
		const tip = {
			...EMPTY_TIP,
			height: 9_612_390,
			nodeTip: 9_612_408,
			bitcoin: 972_418,
			bitcoinSeenAt: NOW - 3 * 60_000,
		};
		expect(chainRows(behind, tip, NOW)).toEqual([
			["Chain tip", "9,612,408"],
			["Our index", "9,612,390 · 18 behind"],
		]);
		expect(chainRows(stalled(4), tip, NOW)).toEqual([
			["Last Stacks block", "9,612,390 · 4 min ago"],
			["Last Bitcoin block", "972,418 · 3 min ago"],
			["Our index", "at the tip"],
		]);
		expect(chainRows(unreachable, tip, NOW)[0]).toEqual([
			"Retrying",
			"every 5 s",
		]);
	});

	test("body and dismiss hint", () => {
		expect(chainBody(stalled(4))).toContain("Nothing is lost.");
		expect(dismissHint(stalled(4))).toBe("Comes back if it gets worse.");
		expect(dismissHint(unreachable)).toBe("Hidden until it clears.");
	});
});
