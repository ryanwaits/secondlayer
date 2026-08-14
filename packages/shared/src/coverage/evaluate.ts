/**
 * Coverage evaluator — one library for stage state.
 *
 * Pure. Callers assemble evidence; this file does not touch the database.
 * `complete` is coverage through the recorded target, not currency.
 * `caught_up` additionally requires a fresh source tip and coverage through
 * the finalized boundary. `complete_through` is never conflated with
 * `source_tip`.
 */

import { decodeStreamsCursor } from "../streams-cursor.ts";
import {
	type CoverageRange,
	type FailureClass,
	type FailureUnit,
	type NativeClock,
	type RepairMode,
	type RetryState,
	type RunStatus,
	type StageKind,
	rangeIsOrdered,
} from "./constraints.ts";

export const COVERAGE_REPORT_SCHEMA_VERSION = 1 as const;

export const COVERAGE_STATES = [
	"complete",
	"syncing",
	"lagging",
	"gap",
	"stale",
	"failed",
	"unverified_import",
	"unanchored",
	"source_unavailable",
	"out_of_scope",
	"disabled",
] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

const HARD_DEP_STATES = new Set<CoverageState>([
	"disabled",
	"failed",
	"source_unavailable",
	"out_of_scope",
	"unverified_import",
	"unanchored",
	"gap",
]);

const DEFAULT_MAX_BLOCKS_BEHIND_FINALIZED = 256;
const DEFAULT_MAX_SOURCE_AGE_SECONDS = 300;

export type BootstrapSource = "archive" | "genesis" | "import";

export type SyncScope = {
	network: string;
	start_height: number;
	target_height: number | null;
	bootstrap: {
		source: BootstrapSource;
		manifest_digest: string | null;
		genesis_hash: string | null;
	};
};

export type StageDeclaration = {
	id: string;
	kind: StageKind;
	depends_on: string | null;
	native_clock: NativeClock;
	producer_version: string;
	repair_mode: RepairMode;
	enabled: boolean;
};

export type StageRunView = {
	stage_id: string;
	code_hash: string;
	config_hash: string;
	handler_hash: string | null;
	target_height: number | null;
	target_cursor: string | null;
	status: RunStatus;
	complete_through: number | null;
};

export type OpenFailure = {
	unit_kind: FailureUnit;
	class: FailureClass;
	retry_state: Exclude<RetryState, "resolved">;
	from_height: number | null;
	to_height: number | null;
};

export type QueueCounters = {
	accepted: number;
	decided: number;
	enqueued: number;
	delivered: number;
	dead: number;
	fence_cursor: string | null;
};

export type StageEvidence = {
	stage_id: string;
	ranges: CoverageRange[];
	open_failures: OpenFailure[];
	cursor: string | null;
	queue: QueueCounters | null;
	unanchored: boolean;
	unverified_import: boolean;
	/** False when this stage's native source (node, bitcoin RPC, …) is down. */
	source_available: boolean;
};

export type SourceClock = {
	tip_height: number | null;
	finalized_height: number | null;
	observed_at: string | null;
};

export type EvaluatorOptions = {
	now: Date;
	maxBlocksBehindFinalized?: number;
	maxSourceAgeSeconds?: number;
};

export type EvaluatorInput = {
	scope: SyncScope;
	stages: StageDeclaration[];
	runs: StageRunView[];
	evidence: StageEvidence[];
	source: SourceClock;
	options: EvaluatorOptions;
};

export type StageCoverage = {
	stage_id: string;
	kind: StageKind;
	native_clock: NativeClock;
	depends_on: string | null;
	state: CoverageState;
	detail: string;
	complete_through: number | null;
	source_tip: number | null;
	finalized_height: number | null;
	recorded_target: number | null;
	declared_range: { from_height: number; to_height: number } | null;
	gaps: CoverageRange[];
	caught_up: boolean;
	blocked_by: string | null;
};

export type CoverageReport = {
	schema_version: typeof COVERAGE_REPORT_SCHEMA_VERSION;
	network: string;
	generated_at: string;
	source_tip: number | null;
	finalized_height: number | null;
	stages: StageCoverage[];
	evaluation_order: string[];
	cycles: string[][];
};

export function mergeRanges(ranges: readonly CoverageRange[]): CoverageRange[] {
	const sorted = ranges
		.filter((r) => rangeIsOrdered(r.from_height, r.to_height))
		.map((r) => ({ from_height: r.from_height, to_height: r.to_height }))
		.sort((a, b) => a.from_height - b.from_height || a.to_height - b.to_height);
	const out: CoverageRange[] = [];
	for (const range of sorted) {
		const last = out[out.length - 1];
		if (last && range.from_height <= last.to_height + 1) {
			last.to_height = Math.max(last.to_height, range.to_height);
		} else {
			out.push(range);
		}
	}
	return out;
}

/** Highest height reachable from `start` without a hole. */
export function contiguousThrough(
	ranges: readonly CoverageRange[],
	start: number,
): number | null {
	const merged = mergeRanges(ranges);
	let through: number | null = null;
	let need = start;
	for (const range of merged) {
		if (range.to_height < need) continue;
		if (range.from_height > need) break;
		through = range.to_height;
		need = range.to_height + 1;
	}
	return through;
}

export function findRangeGaps(
	ranges: readonly CoverageRange[],
	from: number,
	to: number,
): CoverageRange[] {
	if (to < from) return [];
	const merged = mergeRanges(ranges);
	const gaps: CoverageRange[] = [];
	let cursor = from;
	for (const range of merged) {
		if (range.to_height < from) continue;
		if (range.from_height > to) break;
		if (range.from_height > cursor) {
			gaps.push({
				from_height: cursor,
				to_height: Math.min(range.from_height - 1, to),
			});
		}
		cursor = Math.max(cursor, range.to_height + 1);
		if (cursor > to) break;
	}
	if (cursor <= to) {
		gaps.push({ from_height: cursor, to_height: to });
	}
	return gaps;
}

export function cursorHeight(cursor: string | null): number | null {
	if (!cursor) return null;
	try {
		return decodeStreamsCursor(cursor).block_height;
	} catch {
		return null;
	}
}

export function topoSort(stages: readonly StageDeclaration[]): {
	order: string[];
	cycles: string[][];
} {
	const ids = new Set(stages.map((s) => s.id));
	const incoming = new Map<string, number>();
	const outgoing = new Map<string, string[]>();
	for (const stage of stages) {
		incoming.set(stage.id, 0);
		outgoing.set(stage.id, []);
	}
	for (const stage of stages) {
		if (!stage.depends_on || !ids.has(stage.depends_on)) continue;
		outgoing.get(stage.depends_on)?.push(stage.id);
		incoming.set(stage.id, (incoming.get(stage.id) ?? 0) + 1);
	}
	const queue = [...incoming.entries()]
		.filter(([, n]) => n === 0)
		.map(([id]) => id)
		.sort();
	const order: string[] = [];
	while (queue.length > 0) {
		const id = queue.shift();
		if (!id) break;
		order.push(id);
		for (const next of outgoing.get(id) ?? []) {
			const left = (incoming.get(next) ?? 1) - 1;
			incoming.set(next, left);
			if (left === 0) queue.push(next);
			queue.sort();
		}
	}
	const leftover = stages.map((s) => s.id).filter((id) => !order.includes(id));
	return { order, cycles: leftover.length > 0 ? [leftover.sort()] : [] };
}

function lastByStage<T extends { stage_id: string }>(
	rows: readonly T[],
): Map<string, T> {
	const map = new Map<string, T>();
	for (const row of rows) map.set(row.stage_id, row);
	return map;
}

function emptyEvidence(stageId: string): StageEvidence {
	return {
		stage_id: stageId,
		ranges: [],
		open_failures: [],
		cursor: null,
		queue: null,
		unanchored: false,
		unverified_import: false,
		source_available: true,
	};
}

function declaredEnd(args: {
	run: StageRunView | undefined;
	scope: SyncScope;
	source: SourceClock;
}): number | null {
	return (
		args.run?.target_height ??
		args.scope.target_height ??
		args.source.finalized_height ??
		args.source.tip_height
	);
}

function clockRanges(
	stage: StageDeclaration,
	evidence: StageEvidence,
): {
	ranges: CoverageRange[];
	invalidCursor: boolean;
} {
	if (stage.native_clock === "block") {
		return { ranges: evidence.ranges, invalidCursor: false };
	}
	const cursor =
		stage.native_clock === "cursor"
			? evidence.cursor
			: (evidence.queue?.fence_cursor ?? null);
	if (!cursor) return { ranges: evidence.ranges, invalidCursor: false };
	const height = cursorHeight(cursor);
	if (height === null) return { ranges: evidence.ranges, invalidCursor: true };
	return {
		ranges: mergeRanges([
			...evidence.ranges,
			{ from_height: 0, to_height: height },
		]),
		invalidCursor: false,
	};
}

function queueCaught(queue: QueueCounters | null): boolean {
	if (!queue) return false;
	return (
		queue.accepted === queue.decided &&
		queue.delivered + queue.dead === queue.accepted
	);
}

function sourceAgeSeconds(source: SourceClock, now: Date): number | null {
	if (!source.observed_at) return source.tip_height === null ? null : 0;
	const observed = Date.parse(source.observed_at);
	if (Number.isNaN(observed)) return null;
	return Math.max(0, Math.round((now.getTime() - observed) / 1000));
}

function evaluateOne(
	stage: StageDeclaration,
	input: EvaluatorInput,
	run: StageRunView | undefined,
	evidence: StageEvidence,
	dep: StageCoverage | null,
	missingDep: boolean,
	inCycle: boolean,
): StageCoverage {
	const sourceTip = input.source.tip_height;
	const finalized = input.source.finalized_height;
	const recordedTarget = run?.target_height ?? input.scope.target_height;
	const maxBehind =
		input.options.maxBlocksBehindFinalized ??
		DEFAULT_MAX_BLOCKS_BEHIND_FINALIZED;
	const maxAge =
		input.options.maxSourceAgeSeconds ?? DEFAULT_MAX_SOURCE_AGE_SECONDS;
	const age = sourceAgeSeconds(input.source, input.options.now);
	const sourceFresh =
		sourceTip !== null && finalized !== null && (age === null || age <= maxAge);

	const base = {
		stage_id: stage.id,
		kind: stage.kind,
		native_clock: stage.native_clock,
		depends_on: stage.depends_on,
		source_tip: sourceTip,
		finalized_height: finalized,
		recorded_target: recordedTarget,
	};

	const done = (
		state: CoverageState,
		detail: string,
		extra: Partial<StageCoverage> = {},
	): StageCoverage => {
		const completeThrough = extra.complete_through ?? null;
		const caughtUp =
			extra.caught_up ??
			(state !== "disabled" &&
				state !== "failed" &&
				state !== "gap" &&
				state !== "out_of_scope" &&
				state !== "unverified_import" &&
				state !== "unanchored" &&
				state !== "source_unavailable" &&
				completeThrough !== null &&
				finalized !== null &&
				completeThrough >= finalized &&
				sourceFresh);
		return {
			...base,
			state,
			detail,
			complete_through: completeThrough,
			declared_range: extra.declared_range ?? null,
			gaps: extra.gaps ?? [],
			caught_up: caughtUp,
			blocked_by: extra.blocked_by ?? null,
		};
	};

	if (!stage.enabled) {
		return done("disabled", "stage is disabled");
	}
	if (inCycle) {
		return done("failed", "dependency cycle");
	}
	if (missingDep) {
		return done("failed", `depends on unknown stage ${stage.depends_on}`);
	}
	if (dep && HARD_DEP_STATES.has(dep.state)) {
		return done(dep.state, `blocked by ${dep.stage_id}: ${dep.detail}`, {
			complete_through: dep.complete_through,
			blocked_by: dep.stage_id,
			declared_range: dep.declared_range,
			gaps: dep.gaps,
			caught_up: false,
		});
	}

	if (evidence.open_failures.length > 0 || run?.status === "failed") {
		const first = evidence.open_failures[0];
		return done(
			"failed",
			first
				? `open ${first.class} failure (${first.retry_state})`
				: "run marked failed",
		);
	}
	if (evidence.unverified_import || run?.status === "unverified_import") {
		return done("unverified_import", "imported data has not been audited");
	}
	if (evidence.unanchored || run?.status === "unanchored") {
		return done(
			"unanchored",
			"receipts are missing a block hash or node anchor",
		);
	}
	if (!evidence.source_available) {
		return done("source_unavailable", "native source is unavailable");
	}

	const { ranges, invalidCursor } = clockRanges(stage, evidence);
	if (invalidCursor) {
		return done("failed", "native clock cursor is not a valid streams cursor");
	}

	const end = declaredEnd({ run, scope: input.scope, source: input.source });
	if (end !== null && end < input.scope.start_height) {
		return done("out_of_scope", "recorded target is below the instance start");
	}

	const sourceSilent =
		sourceTip === null && finalized === null && recordedTarget === null;
	if (sourceSilent) {
		return done(
			"source_unavailable",
			"the chain source could not be reached, so the declared range is unknown",
		);
	}

	if (end === null) {
		return done(
			"source_unavailable",
			"no recorded target and the source tip is unknown",
		);
	}

	const declaredRange = {
		from_height: input.scope.start_height,
		to_height: end,
	};
	let completeThrough = contiguousThrough(ranges, input.scope.start_height);
	if (dep?.complete_through !== null && dep?.complete_through !== undefined) {
		if (completeThrough === null) {
			// stay null
		} else {
			completeThrough = Math.min(completeThrough, dep.complete_through);
		}
	} else if (dep && dep.complete_through === null) {
		completeThrough = null;
	}

	const gaps = findRangeGaps(
		ranges,
		declaredRange.from_height,
		declaredRange.to_height,
	);
	const tiled =
		gaps.length === 0 &&
		completeThrough !== null &&
		completeThrough >= declaredRange.to_height;
	// A single suffix still ahead of the prefix is unfinished work, not a hole.
	const trailingGap =
		gaps.length === 1 &&
		gaps[0].to_height === declaredRange.to_height &&
		(completeThrough === null
			? gaps[0].from_height === declaredRange.from_height
			: gaps[0].from_height === completeThrough + 1);

	const queueIncomplete =
		stage.native_clock === "queue" && !queueCaught(evidence.queue);

	if (gaps.length > 0 && !trailingGap) {
		const first = gaps[0];
		return done("gap", `missing ${first.from_height}–${first.to_height}`, {
			complete_through: completeThrough,
			declared_range: declaredRange,
			gaps,
			caught_up: false,
		});
	}

	if (queueIncomplete || !tiled) {
		return done(
			"syncing",
			"contiguous from start, not yet through the recorded target",
			{
				complete_through: completeThrough,
				declared_range: declaredRange,
				gaps,
				caught_up: false,
			},
		);
	}

	const sourceStale = age !== null && age > maxAge;
	const behindFinalized =
		finalized !== null && completeThrough !== null
			? Math.max(0, finalized - completeThrough)
			: null;
	const behindTip =
		sourceTip !== null && completeThrough !== null
			? Math.max(0, sourceTip - completeThrough)
			: null;
	// A target below the current finalized height is a pin, not a live follow.
	// That instance is complete through what it asked for — not lagging.
	const pinned =
		recordedTarget !== null && finalized !== null && recordedTarget < finalized;

	if (sourceStale) {
		return done(
			"stale",
			`source observation is ${age}s old, beyond the ${maxAge}s freshness objective`,
			{
				complete_through: completeThrough,
				declared_range: declaredRange,
				gaps,
				caught_up: false,
			},
		);
	}

	if (behindFinalized !== null && behindFinalized > maxBehind) {
		return done(
			"stale",
			`${behindFinalized} blocks behind the finalized height, beyond the ${maxBehind} threshold`,
			{
				complete_through: completeThrough,
				declared_range: declaredRange,
				gaps,
				caught_up: false,
			},
		);
	}

	if (!pinned && behindFinalized !== null && behindFinalized > 0) {
		return done(
			"lagging",
			`${behindFinalized} blocks behind the finalized height`,
			{
				complete_through: completeThrough,
				declared_range: declaredRange,
				gaps,
				caught_up: false,
			},
		);
	}

	if (!pinned && behindTip !== null && behindTip > 0) {
		return done("lagging", `${behindTip} blocks behind the chain tip`, {
			complete_through: completeThrough,
			declared_range: declaredRange,
			gaps,
		});
	}

	return done("complete", "processed every unit through the recorded target", {
		complete_through: completeThrough,
		declared_range: declaredRange,
		gaps,
	});
}

export function evaluateCoverage(input: EvaluatorInput): CoverageReport {
	const { order, cycles } = topoSort(input.stages);
	const cyclic = new Set(cycles.flat());
	const known = new Set(input.stages.map((s) => s.id));
	const runs = lastByStage(input.runs);
	const evidence = lastByStage(input.evidence);
	const byId = new Map(input.stages.map((s) => [s.id, s]));
	const evaluated = new Map<string, StageCoverage>();

	const visit = (id: string): void => {
		const stage = byId.get(id);
		if (!stage || evaluated.has(id)) return;
		const depId = stage.depends_on;
		const missingDep = Boolean(depId && !known.has(depId));
		const dep = depId && !missingDep ? (evaluated.get(depId) ?? null) : null;
		evaluated.set(
			id,
			evaluateOne(
				stage,
				input,
				runs.get(id),
				evidence.get(id) ?? emptyEvidence(id),
				dep,
				missingDep,
				cyclic.has(id),
			),
		);
	};

	for (const id of order) visit(id);
	for (const id of cyclic) visit(id);

	const stages = [...evaluated.values()].sort((a, b) =>
		a.stage_id.localeCompare(b.stage_id),
	);

	return {
		schema_version: COVERAGE_REPORT_SCHEMA_VERSION,
		network: input.scope.network,
		generated_at: input.options.now.toISOString(),
		source_tip: input.source.tip_height,
		finalized_height: input.source.finalized_height,
		stages,
		evaluation_order: order,
		cycles,
	};
}
