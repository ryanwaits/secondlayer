#!/usr/bin/env bun
/**
 * Soak report aggregator — the period verdict for P7.1 (seven-day soak).
 *
 * The systemd timers in `docker/systemd/` are stateless oneshots: each one
 * pages once per incident and deliberately discards repetition, so nothing on
 * the host answers "what happened over the last week". This script does. It
 * collects two classes of EVENT over a window —
 *
 *   1. process restarts   (container start times / restart counts)
 *   2. coverage transitions (`stage_runs.status` history, plus a derived
 *      state series from `subgraph_health_snapshots`)
 *
 * — matches each one against a recorded CAUSE (a deploy, a known timer run, an
 * operator-recorded incident, an open stage failure, a detected reorg), and
 * fails the window if anything is left unexplained. P7.1's acceptance is
 * literally "no unexplained coverage transition or process restart", so the
 * verdict is PASS only when `unexplained == 0`.
 *
 * Design: `aggregateSoak` is a PURE function over typed events and causes.
 * Every parser (`parseDockerInspect`, `parseJournalTimerRuns`,
 * `parseDeployState`, `parseCausesFile`, `deriveStageTransitions`,
 * `deriveSnapshotTransitions`) is pure too — they take text or rows, never a
 * socket. IO (docker, journalctl, postgres) lives only in `collect*` /
 * `fetch*` and `main`. That is what makes the aggregation unit-testable with
 * no Docker and no database.
 *
 * Usage:
 *   bun scripts/ops/soak-report.ts --since 7d
 *   bun scripts/ops/soak-report.ts --since 7d --json
 *   bun scripts/ops/soak-report.ts --since 24h --docker-json ./inspect.json \
 *       --journal-json ./journal.jsonl --causes ./incidents.json --no-db
 *
 * Exit codes: 0 pass, 1 fail (unexplained events), 2 inconclusive (a source
 * could not be read, so absence of events is not evidence of absence).
 *
 * Data sources (each optional, each recorded in `report.sources`):
 *   - `docker ps -aq` + `docker inspect`   → restart events (or --docker-json)
 *   - `journalctl -o json -u 'secondlayer-*'` → timer-run causes (or --journal-json)
 *   - `$DEPLOY_STATE_DIR/last-success.env` → the deploy cause (docker/scripts/deploy.sh)
 *   - SOURCE db `stage_runs`               → coverage transitions
 *   - SOURCE db `stage_failures`, `chain_reorgs` → incident causes
 *   - TARGET db `subgraph_health_snapshots` → derived subgraph coverage transitions
 *   - `--causes <file>`                     → operator-recorded incidents/deploys
 */

// Source import, not the package specifier: this is an ops script run straight
// from the repo, so it must typecheck against the coverage vocabulary itself
// rather than a built `dist`.
import type { CoverageState } from "../../packages/shared/src/coverage/evaluate.ts";

export const SOAK_REPORT_SCHEMA_VERSION = 1 as const;

const DEFAULT_TOLERANCE_SECONDS = 300;
/** A subgraph whose last processed block has not moved for this long, while
 *  snapshots keep being captured, is treated as `stale`. */
const DEFAULT_SNAPSHOT_STALE_SECONDS = 1800;
/** How far before the window we look for the state a stage was already in. */
const PRIOR_STATE_LOOKBACK_DAYS = 30;

// ---------------------------------------------------------------------------
// Domain types (pure)
// ---------------------------------------------------------------------------

export type SoakWindow = { since: string; until: string };

export type RestartEvent = {
	kind: "restart";
	at: string;
	container: string;
	image: string | null;
	image_digest: string | null;
	restart_count: number;
	exit_code: number | null;
	source: "docker" | "journal";
};

export type CoverageTransitionEvent = {
	kind: "coverage_transition";
	at: string;
	stage_id: string;
	/** null when the window opens with no earlier observation. */
	from: CoverageState | null;
	to: CoverageState;
	complete_through: number | null;
	source: "stage_runs" | "subgraph_health_snapshots";
};

export type SoakEvent = RestartEvent | CoverageTransitionEvent;

export type CauseKind = "deploy" | "timer_run" | "incident";

/**
 * A recorded reason an event could legitimately happen.
 *
 * Scope: an empty/absent `containers` and `stages` means the cause is global.
 * A `deploy` always covers every stage (a deploy restarts the whole compose
 * project) unless it names stages explicitly.
 */
export type SoakCause = {
	kind: CauseKind;
	id: string;
	at: string;
	/** End of the cause interval; null for a point-in-time cause. */
	until: string | null;
	label: string;
	containers?: string[];
	stages?: string[];
	image_digest?: string | null;
};

export type MatchedCause = {
	kind: CauseKind;
	id: string;
	label: string;
	at: string;
	distance_seconds: number;
};

export type ExplainedEvent = {
	event: SoakEvent;
	explained: boolean;
	cause: MatchedCause | null;
	reason: string;
};

export type SoakInput = {
	window: SoakWindow;
	events: SoakEvent[];
	causes: SoakCause[];
	generated_at: string;
	tolerance_seconds?: number;
	/** Provenance labels, e.g. "docker(inspect)", "db(stage_runs)". */
	sources?: string[];
	/** Sources that could not be read — makes the window inconclusive. */
	warnings?: string[];
};

export type SoakReport = {
	schema_version: typeof SOAK_REPORT_SCHEMA_VERSION;
	generated_at: string;
	window: SoakWindow;
	tolerance_seconds: number;
	sources: string[];
	warnings: string[];
	verdict: "pass" | "fail";
	conclusive: boolean;
	totals: {
		restarts: number;
		coverage_transitions: number;
		explained: number;
		unexplained: number;
		causes: number;
	};
	restarts: ExplainedEvent[];
	coverage_transitions: ExplainedEvent[];
	unexplained: ExplainedEvent[];
};

// ---------------------------------------------------------------------------
// Pure aggregation
// ---------------------------------------------------------------------------

function toMs(value: string | null | undefined): number | null {
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
}

const CAUSE_PRIORITY: Record<CauseKind, number> = {
	deploy: 0,
	incident: 1,
	timer_run: 2,
};

function causeCoversEvent(cause: SoakCause, event: SoakEvent): boolean {
	const containers = cause.containers ?? [];
	const stages = cause.stages ?? [];
	if (event.kind === "restart") {
		if (containers.length > 0) return containers.includes(event.container);
		return stages.length === 0;
	}
	if (stages.length > 0) return stages.includes(event.stage_id);
	if (cause.kind === "deploy") return true;
	return containers.length === 0;
}

/** Distance in ms from an event to a cause interval, or null if out of reach. */
function causeDistanceMs(
	cause: SoakCause,
	eventMs: number,
	toleranceMs: number,
): number | null {
	const start = toMs(cause.at);
	if (start === null) return null;
	const end = toMs(cause.until) ?? start;
	if (eventMs < start - toleranceMs) return null;
	if (eventMs > end + toleranceMs) return null;
	if (eventMs < start) return start - eventMs;
	if (eventMs > end) return eventMs - end;
	return 0;
}

function eventTimeMs(event: SoakEvent): number | null {
	return toMs(event.at);
}

function eventScopeLabel(event: SoakEvent): string {
	return event.kind === "restart" ? event.container : event.stage_id;
}

function explainEvent(
	event: SoakEvent,
	causes: readonly SoakCause[],
	toleranceMs: number,
): ExplainedEvent {
	const at = eventTimeMs(event);
	if (at === null) {
		return {
			event,
			explained: false,
			cause: null,
			reason: `timestamp '${event.at}' is not parseable`,
		};
	}

	let best: { cause: SoakCause; distance: number } | null = null;
	for (const cause of causes) {
		if (!causeCoversEvent(cause, event)) continue;
		const distance = causeDistanceMs(cause, at, toleranceMs);
		if (distance === null) continue;
		if (
			!best ||
			distance < best.distance ||
			(distance === best.distance &&
				CAUSE_PRIORITY[cause.kind] < CAUSE_PRIORITY[best.cause.kind]) ||
			(distance === best.distance &&
				CAUSE_PRIORITY[cause.kind] === CAUSE_PRIORITY[best.cause.kind] &&
				cause.id < best.cause.id)
		) {
			best = { cause, distance };
		}
	}

	if (!best) {
		return {
			event,
			explained: false,
			cause: null,
			reason: `no recorded deploy, timer run, or incident covers ${eventScopeLabel(event)} at ${event.at}`,
		};
	}

	return {
		event,
		explained: true,
		cause: {
			kind: best.cause.kind,
			id: best.cause.id,
			label: best.cause.label,
			at: best.cause.at,
			distance_seconds: Math.round(best.distance / 1000),
		},
		reason: `${best.cause.kind} ${best.cause.label}`,
	};
}

function inWindow(event: SoakEvent, window: SoakWindow): boolean {
	const at = eventTimeMs(event);
	// An unparseable timestamp is kept: it is a defect worth failing on, not
	// something to silently drop out of the window.
	if (at === null) return true;
	const since = toMs(window.since);
	const until = toMs(window.until);
	if (since !== null && at < since) return false;
	if (until !== null && at > until) return false;
	return true;
}

function byTimeThenScope(a: ExplainedEvent, b: ExplainedEvent): number {
	const at = toMs(a.event.at) ?? 0;
	const bt = toMs(b.event.at) ?? 0;
	if (at !== bt) return at - bt;
	return eventScopeLabel(a.event).localeCompare(eventScopeLabel(b.event));
}

/**
 * The whole verdict, as a pure function. No IO, no clock — `generated_at` is
 * supplied by the caller so the output is reproducible in tests.
 */
export function aggregateSoak(input: SoakInput): SoakReport {
	const toleranceSeconds = input.tolerance_seconds ?? DEFAULT_TOLERANCE_SECONDS;
	const toleranceMs = toleranceSeconds * 1000;
	const warnings = input.warnings ?? [];

	const evaluated = input.events
		.filter((event) => inWindow(event, input.window))
		.map((event) => explainEvent(event, input.causes, toleranceMs));

	const restarts = evaluated
		.filter((e) => e.event.kind === "restart")
		.sort(byTimeThenScope);
	const transitions = evaluated
		.filter((e) => e.event.kind === "coverage_transition")
		.sort(byTimeThenScope);
	const unexplained = evaluated
		.filter((e) => !e.explained)
		.sort(byTimeThenScope);

	return {
		schema_version: SOAK_REPORT_SCHEMA_VERSION,
		generated_at: input.generated_at,
		window: input.window,
		tolerance_seconds: toleranceSeconds,
		sources: input.sources ?? [],
		warnings,
		verdict: unexplained.length === 0 ? "pass" : "fail",
		conclusive: warnings.length === 0,
		totals: {
			restarts: restarts.length,
			coverage_transitions: transitions.length,
			explained: evaluated.length - unexplained.length,
			unexplained: unexplained.length,
			causes: input.causes.length,
		},
		restarts,
		coverage_transitions: transitions,
		unexplained,
	};
}

function describeEvent(entry: ExplainedEvent): string {
	const event = entry.event;
	const head =
		event.kind === "restart"
			? `${event.at}  ${event.container}  restart_count=${event.restart_count} exit=${event.exit_code ?? "?"} image=${event.image_digest ?? event.image ?? "unknown"}`
			: `${event.at}  ${event.stage_id}  ${event.from ?? "(none)"} -> ${event.to} complete_through=${event.complete_through ?? "?"}`;
	const tail = entry.explained
		? `<- ${entry.reason} (+${entry.cause?.distance_seconds ?? 0}s)`
		: `<- UNEXPLAINED: ${entry.reason}`;
	return `  ${head}  ${tail}`;
}

/** Human-readable rendering. Pure — same input, same text. */
export function formatSoakReport(report: SoakReport): string {
	const lines: string[] = [
		`soak report ${report.window.since} -> ${report.window.until}`,
		`generated_at ${report.generated_at}  tolerance ${report.tolerance_seconds}s`,
		`sources: ${report.sources.length > 0 ? report.sources.join(", ") : "none"}`,
		`causes: ${report.totals.causes}`,
	];

	lines.push(
		`restarts: ${report.totals.restarts} (${report.restarts.filter((e) => !e.explained).length} unexplained)`,
	);
	for (const entry of report.restarts) lines.push(describeEvent(entry));

	lines.push(
		`coverage transitions: ${report.totals.coverage_transitions} (${report.coverage_transitions.filter((e) => !e.explained).length} unexplained)`,
	);
	for (const entry of report.coverage_transitions)
		lines.push(describeEvent(entry));

	for (const warning of report.warnings) lines.push(`warning: ${warning}`);

	if (report.verdict === "pass") {
		lines.push(
			report.conclusive
				? "verdict: PASS — every restart and coverage transition has a recorded cause"
				: "verdict: PASS (INCONCLUSIVE) — no unexplained events, but a source could not be read",
		);
	} else {
		lines.push(
			`verdict: FAIL — ${report.totals.unexplained} unexplained event(s)`,
		);
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Pure parsers (text/rows -> typed events and causes)
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Accepts a JSON array, a single JSON object, or newline-delimited JSON. */
export function parseJsonDocuments(text: string): unknown[] {
	const trimmed = text.trim();
	if (trimmed.length === 0) return [];
	try {
		const parsed = JSON.parse(trimmed);
		return Array.isArray(parsed) ? parsed : [parsed];
	} catch {
		// fall through to NDJSON
	}
	const out: unknown[] = [];
	for (const line of trimmed.split("\n")) {
		const value = line.trim();
		if (value.length === 0) continue;
		try {
			out.push(JSON.parse(value));
		} catch {
			// A single malformed line should not discard the rest of the file.
		}
	}
	return out;
}

function shortDigest(image: string | null): string | null {
	if (!image) return null;
	const at = image.indexOf("@");
	if (at === -1) return image;
	return image.slice(at + 1);
}

/**
 * `docker inspect` output -> restart events.
 *
 * Note the limitation this parser inherits from Docker: `State.StartedAt` is
 * the LAST start only, so a container that restarted several times inside the
 * window contributes one event carrying `RestartCount`. Earlier starts have to
 * come from the journal. The report never claims more than it can see.
 */
export function parseDockerInspect(text: string): RestartEvent[] {
	const events: RestartEvent[] = [];
	for (const doc of parseJsonDocuments(text)) {
		const record = asRecord(doc);
		const state = asRecord(record.State);
		const startedAt =
			typeof state.StartedAt === "string"
				? state.StartedAt
				: typeof record.StartedAt === "string"
					? record.StartedAt
					: null;
		if (!startedAt) continue;
		const at = toMs(startedAt);
		if (at === null) continue;
		const rawName =
			typeof record.Name === "string"
				? record.Name
				: typeof record.Names === "string"
					? record.Names
					: "";
		const container = rawName.replace(/^\//, "") || "unknown";
		const image =
			typeof record.Image === "string"
				? record.Image
				: typeof asRecord(record.Config).Image === "string"
					? String(asRecord(record.Config).Image)
					: null;
		events.push({
			kind: "restart",
			at: new Date(at).toISOString(),
			container,
			image,
			image_digest: shortDigest(image),
			restart_count: Number(record.RestartCount ?? 0) || 0,
			exit_code:
				typeof state.ExitCode === "number" ? (state.ExitCode as number) : null,
			source: "docker",
		});
	}
	return events;
}

/**
 * `journalctl -o json -u 'secondlayer-*'` -> one timer_run cause per service
 * invocation. Grouping by `_SYSTEMD_INVOCATION_ID` gives the exact run
 * interval, which is what a restart or coverage transition has to fall inside
 * to count as "a known timer run did this".
 */
export function parseJournalTimerRuns(text: string): SoakCause[] {
	const runs = new Map<string, { unit: string; first: number; last: number }>();
	for (const doc of parseJsonDocuments(text)) {
		const record = asRecord(doc);
		const unit =
			typeof record._SYSTEMD_UNIT === "string"
				? record._SYSTEMD_UNIT
				: typeof record.UNIT === "string"
					? record.UNIT
					: null;
		if (!unit) continue;
		const stampRaw = record.__REALTIME_TIMESTAMP;
		const micros = Number(stampRaw);
		if (!Number.isFinite(micros) || micros <= 0) continue;
		const ms = Math.floor(micros / 1000);
		const invocation =
			typeof record._SYSTEMD_INVOCATION_ID === "string"
				? record._SYSTEMD_INVOCATION_ID
				: `${unit}:${new Date(ms).toISOString().slice(0, 16)}`;
		const existing = runs.get(invocation);
		if (existing) {
			existing.first = Math.min(existing.first, ms);
			existing.last = Math.max(existing.last, ms);
		} else {
			runs.set(invocation, { unit, first: ms, last: ms });
		}
	}

	return [...runs.entries()]
		.map(([invocation, run]) => ({
			kind: "timer_run" as const,
			id: `timer:${invocation}`,
			at: new Date(run.first).toISOString(),
			until: new Date(run.last).toISOString(),
			label: run.unit,
		}))
		.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * `$DEPLOY_STATE_DIR/last-success.env` (written by
 * docker/scripts/deploy.sh `record_successful_deploy`) -> the deploy cause.
 * Values are shell-quoted by `printf %q`, so strip one layer of quoting.
 */
export function parseDeployState(text: string): SoakCause | null {
	const env: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
		if (!match) continue;
		let value = match[2].trim();
		if (value.startsWith("$'") && value.endsWith("'")) {
			value = value.slice(2, -1);
		} else if (
			(value.startsWith("'") && value.endsWith("'")) ||
			(value.startsWith('"') && value.endsWith('"'))
		) {
			value = value.slice(1, -1);
		}
		env[match[1]] = value;
	}
	const at = env.DEPLOY_RECORDED_AT;
	if (!at || toMs(at) === null) return null;
	const sha = env.DEPLOY_SHA || env.DEPLOY_IMAGE_TAG || "unknown";
	return {
		kind: "deploy",
		id: `deploy:${sha}`,
		at: new Date(Date.parse(at)).toISOString(),
		until: null,
		label: `deploy ${sha}${env.DEPLOY_IMAGE_TAG ? ` (tag ${env.DEPLOY_IMAGE_TAG})` : ""}`,
		image_digest: sha,
	};
}

/**
 * Operator-recorded causes file: a JSON array (or NDJSON) of
 * `{kind, at, until?, label, containers?, stages?}`. Anything without a
 * parseable `at` is rejected rather than quietly explaining events.
 */
export function parseCausesFile(text: string): SoakCause[] {
	const causes: SoakCause[] = [];
	let index = 0;
	for (const doc of parseJsonDocuments(text)) {
		const record = asRecord(doc);
		const at = typeof record.at === "string" ? record.at : null;
		if (!at || toMs(at) === null) continue;
		const kind =
			record.kind === "deploy" || record.kind === "timer_run"
				? record.kind
				: "incident";
		const containers = Array.isArray(record.containers)
			? record.containers.map(String)
			: undefined;
		const stages = Array.isArray(record.stages)
			? record.stages.map(String)
			: undefined;
		index += 1;
		causes.push({
			kind,
			id: typeof record.id === "string" ? record.id : `recorded:${index}`,
			at,
			until:
				typeof record.until === "string" && toMs(record.until) !== null
					? record.until
					: null,
			label:
				typeof record.label === "string" ? record.label : `recorded ${kind}`,
			containers,
			stages,
		});
	}
	return causes;
}

// ---------------------------------------------------------------------------
// Coverage history (pure derivation over DB rows)
// ---------------------------------------------------------------------------

export type StageRunRow = {
	stage_id: string;
	status: string;
	started_at: string;
	complete_through: number | null;
};

/**
 * `stage_runs.status` carries the coverage vocabulary plus three lifecycle
 * values. `pending`/`running` are not coverage claims — they say a run exists,
 * not what the data looks like — so they are dropped from the state series
 * rather than manufacturing complete -> running -> complete churn. `halted` is
 * a real coverage claim: the stage stopped and stayed stopped.
 */
export function runStatusToCoverageState(status: string): CoverageState | null {
	switch (status) {
		case "pending":
		case "running":
			return null;
		case "halted":
			return "failed";
		case "complete":
		case "syncing":
		case "lagging":
		case "gap":
		case "stale":
		case "failed":
		case "unverified_import":
		case "unanchored":
		case "source_unavailable":
		case "out_of_scope":
		case "disabled":
			return status;
		default:
			return null;
	}
}

/**
 * Consecutive-different-state pairs per stage. Rows from BEFORE the window are
 * required (and expected) so the first in-window transition knows what state it
 * came from; only transitions whose landing time is inside the window are
 * emitted.
 */
export function deriveStageTransitions(
	rows: readonly StageRunRow[],
	window: SoakWindow,
): CoverageTransitionEvent[] {
	const since = toMs(window.since);
	const until = toMs(window.until);
	const byStage = new Map<string, StageRunRow[]>();
	for (const row of rows) {
		const list = byStage.get(row.stage_id);
		if (list) list.push(row);
		else byStage.set(row.stage_id, [row]);
	}

	const events: CoverageTransitionEvent[] = [];
	for (const [stageId, stageRows] of byStage) {
		const ordered = [...stageRows].sort(
			(a, b) => (toMs(a.started_at) ?? 0) - (toMs(b.started_at) ?? 0),
		);
		let previous: CoverageState | null = null;
		let seenAny = false;
		for (const row of ordered) {
			const state = runStatusToCoverageState(row.status);
			if (state === null) continue;
			const at = toMs(row.started_at);
			if (at === null) continue;
			if (seenAny && state === previous) continue;
			const insideWindow =
				(since === null || at >= since) && (until === null || at <= until);
			if (insideWindow) {
				events.push({
					kind: "coverage_transition",
					at: new Date(at).toISOString(),
					stage_id: stageId,
					from: seenAny ? previous : null,
					to: state,
					complete_through: row.complete_through,
					source: "stage_runs",
				});
			}
			previous = state;
			seenAny = true;
		}
	}
	return events.sort((a, b) => a.at.localeCompare(b.at));
}

export type SubgraphSnapshotRow = {
	subgraph_id: string;
	total_errors: number;
	last_processed_block: number | null;
	captured_at: string;
};

/**
 * `subgraph_health_snapshots` stores counters, not states, so the coverage
 * state is DERIVED from consecutive snapshots:
 *   - errors went up            -> `failed`
 *   - block advanced            -> `syncing`
 *   - block flat for >= stale_s -> `stale`
 *   - block flat, still fresh   -> no claim (the chain is simply quiet)
 * Only changes in that derived series become transitions.
 */
export function deriveSnapshotTransitions(
	rows: readonly SubgraphSnapshotRow[],
	window: SoakWindow,
	options: { stale_seconds?: number } = {},
): CoverageTransitionEvent[] {
	const staleMs =
		(options.stale_seconds ?? DEFAULT_SNAPSHOT_STALE_SECONDS) * 1000;
	const since = toMs(window.since);
	const until = toMs(window.until);

	const bySubgraph = new Map<string, SubgraphSnapshotRow[]>();
	for (const row of rows) {
		const list = bySubgraph.get(row.subgraph_id);
		if (list) list.push(row);
		else bySubgraph.set(row.subgraph_id, [row]);
	}

	const events: CoverageTransitionEvent[] = [];
	for (const [subgraphId, snapshots] of bySubgraph) {
		const ordered = [...snapshots].sort(
			(a, b) => (toMs(a.captured_at) ?? 0) - (toMs(b.captured_at) ?? 0),
		);
		let previousState: CoverageState | null = null;
		let seenAny = false;
		let flatSinceMs: number | null = null;

		for (let i = 1; i < ordered.length; i += 1) {
			const prev = ordered[i - 1];
			const curr = ordered[i];
			const at = toMs(curr.captured_at);
			const prevAt = toMs(prev.captured_at);
			if (at === null || prevAt === null) continue;

			let state: CoverageState | null;
			if (curr.total_errors > prev.total_errors) {
				state = "failed";
				flatSinceMs = null;
			} else if (
				(curr.last_processed_block ?? -1) > (prev.last_processed_block ?? -1)
			) {
				state = "syncing";
				flatSinceMs = null;
			} else {
				if (flatSinceMs === null) flatSinceMs = prevAt;
				state = at - flatSinceMs >= staleMs ? "stale" : null;
			}
			if (state === null) continue;

			const insideWindow =
				(since === null || at >= since) && (until === null || at <= until);
			if (!(seenAny && state === previousState) && insideWindow) {
				events.push({
					kind: "coverage_transition",
					at: new Date(at).toISOString(),
					stage_id: `subgraph:${subgraphId}`,
					from: seenAny ? previousState : null,
					to: state,
					complete_through: curr.last_processed_block,
					source: "subgraph_health_snapshots",
				});
			}
			previousState = state;
			seenAny = true;
		}
	}
	return events.sort((a, b) => a.at.localeCompare(b.at));
}

export type StageFailureRow = {
	stage_id: string;
	class: string;
	retry_state: string;
	last_error: string | null;
	created_at: string;
	resolved_at: string | null;
};

/** An open/resolved stage failure is a recorded cause for that stage. */
export function stageFailureCauses(
	rows: readonly StageFailureRow[],
): SoakCause[] {
	return rows
		.filter((row) => toMs(row.created_at) !== null)
		.map((row, index) => ({
			kind: "incident" as const,
			id: `stage_failure:${row.stage_id}:${index}`,
			at: new Date(Date.parse(row.created_at)).toISOString(),
			until: row.resolved_at
				? new Date(Date.parse(row.resolved_at)).toISOString()
				: null,
			label: `${row.stage_id} ${row.class} failure (${row.retry_state})${
				row.last_error ? `: ${row.last_error.slice(0, 120)}` : ""
			}`,
			stages: [row.stage_id],
		}));
}

export type ReorgRow = {
	detected_at: string;
	fork_point_height: number;
	new_canonical_height: number;
};

/** A detected reorg moves coverage everywhere, so it is a global cause. */
export function reorgCauses(rows: readonly ReorgRow[]): SoakCause[] {
	return rows
		.filter((row) => toMs(row.detected_at) !== null)
		.map((row, index) => ({
			kind: "incident" as const,
			id: `reorg:${row.fork_point_height}:${index}`,
			at: new Date(Date.parse(row.detected_at)).toISOString(),
			until: null,
			label: `reorg at fork ${row.fork_point_height} -> canonical ${row.new_canonical_height}`,
		}));
}

// ---------------------------------------------------------------------------
// Argument parsing (pure)
// ---------------------------------------------------------------------------

export type SoakArgs = {
	since: string;
	until: string;
	json: boolean;
	tolerance_seconds: number;
	docker_json: string | null;
	journal_json: string | null;
	causes_file: string | null;
	deploy_state_dir: string;
	use_docker: boolean;
	use_journal: boolean;
	use_db: boolean;
	help: boolean;
	error: string | null;
};

const DURATION_UNITS: Record<string, number> = {
	s: 1000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
	w: 604_800_000,
};

/** `7d`, `24h`, `90m`, or an absolute ISO timestamp. */
export function resolveSince(spec: string, until: Date): Date | null {
	const duration = /^(\d+)\s*([smhdw])$/.exec(spec.trim());
	if (duration) {
		const amount = Number(duration[1]);
		const unit = DURATION_UNITS[duration[2]];
		return new Date(until.getTime() - amount * unit);
	}
	const absolute = toMs(spec);
	return absolute === null ? null : new Date(absolute);
}

export function parseArgs(argv: readonly string[], now: Date): SoakArgs {
	const args: SoakArgs = {
		since: "",
		until: now.toISOString(),
		json: false,
		tolerance_seconds: DEFAULT_TOLERANCE_SECONDS,
		docker_json: null,
		journal_json: null,
		causes_file: null,
		deploy_state_dir:
			process.env.DEPLOY_STATE_DIR || "/opt/secondlayer/data/deploy",
		use_docker: true,
		use_journal: true,
		use_db: true,
		help: false,
		error: null,
	};

	let sinceSpec = "7d";
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = argv[i + 1];
		switch (arg) {
			case "--help":
			case "-h":
				args.help = true;
				break;
			case "--json":
				args.json = true;
				break;
			case "--no-docker":
				args.use_docker = false;
				break;
			case "--no-journal":
				args.use_journal = false;
				break;
			case "--no-db":
				args.use_db = false;
				break;
			case "--since":
				sinceSpec = next ?? "";
				i += 1;
				break;
			case "--until": {
				const until = toMs(next ?? "");
				if (until === null) args.error = `--until '${next}' is not a timestamp`;
				else args.until = new Date(until).toISOString();
				i += 1;
				break;
			}
			case "--tolerance": {
				const seconds = Number(next);
				if (!Number.isFinite(seconds) || seconds < 0) {
					args.error = `--tolerance '${next}' is not a number of seconds`;
				} else {
					args.tolerance_seconds = seconds;
				}
				i += 1;
				break;
			}
			case "--docker-json":
				args.docker_json = next ?? null;
				i += 1;
				break;
			case "--journal-json":
				args.journal_json = next ?? null;
				i += 1;
				break;
			case "--causes":
				args.causes_file = next ?? null;
				i += 1;
				break;
			case "--deploy-state":
				args.deploy_state_dir = next ?? args.deploy_state_dir;
				i += 1;
				break;
			default:
				if (arg.startsWith("-")) args.error = `unknown flag ${arg}`;
				break;
		}
	}

	const since = resolveSince(sinceSpec, new Date(args.until));
	if (!since) {
		args.error =
			args.error ?? `--since '${sinceSpec}' is not a duration or timestamp`;
		args.since = args.until;
	} else {
		args.since = since.toISOString();
	}
	return args;
}

const USAGE = `soak-report — period verdict for the P7.1 seven-day soak

  bun scripts/ops/soak-report.ts [--since 7d] [--until ISO] [--json]

  --since <7d|24h|ISO>   window start (default 7d before --until)
  --until <ISO>          window end (default now)
  --tolerance <seconds>  how close a cause must be to explain an event (default ${DEFAULT_TOLERANCE_SECONDS})
  --docker-json <file>   read \`docker inspect\` output from a file instead of running docker
  --journal-json <file>  read \`journalctl -o json\` output from a file instead of running journalctl
  --causes <file>        operator-recorded causes: JSON array or NDJSON of {kind,at,until,label,containers,stages}
  --deploy-state <dir>   deploy state dir (default $DEPLOY_STATE_DIR or /opt/secondlayer/data/deploy)
  --no-docker/--no-journal/--no-db   skip a source
  --json                 emit the machine-readable report

Exit: 0 pass, 1 unexplained events, 2 inconclusive (a source could not be read).`;

// ---------------------------------------------------------------------------
// IO shell
// ---------------------------------------------------------------------------

async function run(command: string[]): Promise<string> {
	const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
	const stdout = await new Response(proc.stdout).text();
	const code = await proc.exited;
	if (code !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(
			`${command[0]} exited ${code}: ${stderr.trim().slice(0, 200)}`,
		);
	}
	return stdout;
}

async function collectDockerRestarts(args: SoakArgs): Promise<string> {
	if (args.docker_json) return await Bun.file(args.docker_json).text();
	const ids = (await run(["docker", "ps", "-aq"]))
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (ids.length === 0) return "[]";
	return await run(["docker", "inspect", ...ids]);
}

async function collectJournal(args: SoakArgs): Promise<string> {
	if (args.journal_json) return await Bun.file(args.journal_json).text();
	return await run([
		"journalctl",
		"-o",
		"json",
		"--since",
		args.since,
		"--until",
		args.until,
		"-u",
		"secondlayer-*",
	]);
}

async function readDeployCause(args: SoakArgs): Promise<SoakCause | null> {
	const file = Bun.file(`${args.deploy_state_dir}/last-success.env`);
	if (!(await file.exists())) return null;
	return parseDeployState(await file.text());
}

async function fetchSourcePlane(
	url: string,
	args: SoakArgs,
): Promise<{
	transitions: CoverageTransitionEvent[];
	causes: SoakCause[];
}> {
	const db = new Bun.SQL(url);
	try {
		const lookback = new Date(
			Date.parse(args.since) - PRIOR_STATE_LOOKBACK_DAYS * 86_400_000,
		).toISOString();
		const runRows = (await db`
			SELECT stage_id, status, started_at, complete_through
			FROM stage_runs
			WHERE started_at >= ${lookback}::timestamptz
				AND started_at <= ${args.until}::timestamptz
			ORDER BY stage_id, started_at
		`) as unknown as Array<{
			stage_id: string;
			status: string;
			started_at: Date | string;
			complete_through: string | number | null;
		}>;

		const failureRows = (await db`
			SELECT stage_id, class, retry_state, last_error, created_at, resolved_at
			FROM stage_failures
			WHERE created_at <= ${args.until}::timestamptz
				AND (resolved_at IS NULL OR resolved_at >= ${args.since}::timestamptz)
			ORDER BY created_at
		`) as unknown as Array<{
			stage_id: string;
			class: string;
			retry_state: string;
			last_error: string | null;
			created_at: Date | string;
			resolved_at: Date | string | null;
		}>;

		const reorgRows = (await db`
			SELECT detected_at, fork_point_height, new_canonical_height
			FROM chain_reorgs
			WHERE detected_at >= ${args.since}::timestamptz
				AND detected_at <= ${args.until}::timestamptz
			ORDER BY detected_at
		`) as unknown as Array<{
			detected_at: Date | string;
			fork_point_height: string | number;
			new_canonical_height: string | number;
		}>;

		const transitions = deriveStageTransitions(
			runRows.map((row) => ({
				stage_id: row.stage_id,
				status: row.status,
				started_at: new Date(row.started_at).toISOString(),
				complete_through:
					row.complete_through === null ? null : Number(row.complete_through),
			})),
			{ since: args.since, until: args.until },
		);

		const causes = [
			...stageFailureCauses(
				failureRows.map((row) => ({
					stage_id: row.stage_id,
					class: row.class,
					retry_state: row.retry_state,
					last_error: row.last_error,
					created_at: new Date(row.created_at).toISOString(),
					resolved_at: row.resolved_at
						? new Date(row.resolved_at).toISOString()
						: null,
				})),
			),
			...reorgCauses(
				reorgRows.map((row) => ({
					detected_at: new Date(row.detected_at).toISOString(),
					fork_point_height: Number(row.fork_point_height),
					new_canonical_height: Number(row.new_canonical_height),
				})),
			),
		];

		return { transitions, causes };
	} finally {
		await db.close();
	}
}

async function fetchTargetPlane(
	url: string,
	args: SoakArgs,
): Promise<CoverageTransitionEvent[]> {
	const db = new Bun.SQL(url);
	try {
		const lookback = new Date(
			Date.parse(args.since) - 86_400_000,
		).toISOString();
		const rows = (await db`
			SELECT subgraph_id, total_errors, last_processed_block, captured_at
			FROM subgraph_health_snapshots
			WHERE captured_at >= ${lookback}::timestamptz
				AND captured_at <= ${args.until}::timestamptz
			ORDER BY subgraph_id, captured_at
		`) as unknown as Array<{
			subgraph_id: string;
			total_errors: string | number;
			last_processed_block: string | number | null;
			captured_at: Date | string;
		}>;
		return deriveSnapshotTransitions(
			rows.map((row) => ({
				subgraph_id: row.subgraph_id,
				total_errors: Number(row.total_errors ?? 0),
				last_processed_block:
					row.last_processed_block === null
						? null
						: Number(row.last_processed_block),
				captured_at: new Date(row.captured_at).toISOString(),
			})),
			{ since: args.since, until: args.until },
		);
	} finally {
		await db.close();
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2), new Date());
	if (args.help) {
		console.log(USAGE);
		return;
	}
	if (args.error) {
		console.error(`soak-report: ${args.error}`);
		console.error(USAGE);
		process.exit(1);
	}

	const events: SoakEvent[] = [];
	const causes: SoakCause[] = [];
	const sources: string[] = [];
	const warnings: string[] = [];

	if (args.use_docker) {
		try {
			const restarts = parseDockerInspect(await collectDockerRestarts(args));
			events.push(...restarts);
			sources.push(
				`docker(${args.docker_json ? `file ${args.docker_json}` : "inspect"}): ${restarts.length} container starts`,
			);
		} catch (err) {
			warnings.push(
				`docker restarts unavailable: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	if (args.use_journal) {
		try {
			const timerRuns = parseJournalTimerRuns(await collectJournal(args));
			causes.push(...timerRuns);
			sources.push(
				`journal(${args.journal_json ? `file ${args.journal_json}` : "journalctl"}): ${timerRuns.length} timer runs`,
			);
		} catch (err) {
			warnings.push(
				`journal timer runs unavailable: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	try {
		const deploy = await readDeployCause(args);
		if (deploy) {
			causes.push(deploy);
			sources.push(`deploy state: ${deploy.label}`);
		}
	} catch (err) {
		warnings.push(
			`deploy state unreadable: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (args.causes_file) {
		try {
			const recorded = parseCausesFile(await Bun.file(args.causes_file).text());
			causes.push(...recorded);
			sources.push(`causes file: ${recorded.length} operator records`);
		} catch (err) {
			warnings.push(
				`causes file unreadable: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	if (args.use_db) {
		const sourceUrl =
			process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL || "";
		const targetUrl =
			process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL || "";
		if (!sourceUrl) {
			warnings.push(
				"coverage history skipped: set SOURCE_DATABASE_URL or DATABASE_URL",
			);
		} else {
			try {
				const plane = await fetchSourcePlane(sourceUrl, args);
				events.push(...plane.transitions);
				causes.push(...plane.causes);
				sources.push(
					`db(stage_runs): ${plane.transitions.length} transitions, ${plane.causes.length} recorded causes`,
				);
			} catch (err) {
				warnings.push(
					`coverage history unavailable: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
		if (targetUrl) {
			try {
				const transitions = await fetchTargetPlane(targetUrl, args);
				events.push(...transitions);
				sources.push(
					`db(subgraph_health_snapshots): ${transitions.length} derived transitions`,
				);
			} catch (err) {
				warnings.push(
					`subgraph health history unavailable: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}

	const report = aggregateSoak({
		window: { since: args.since, until: args.until },
		events,
		causes,
		generated_at: new Date().toISOString(),
		tolerance_seconds: args.tolerance_seconds,
		sources,
		warnings,
	});

	console.log(
		args.json ? JSON.stringify(report, null, 2) : formatSoakReport(report),
	);

	if (report.verdict === "fail") process.exit(1);
	if (!report.conclusive) process.exit(2);
}

if (import.meta.main) {
	await main();
}
