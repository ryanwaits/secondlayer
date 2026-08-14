/**
 * Stage runner state machine.
 *
 * Pure. Adapters (P4.5+) persist the returned state and effects.
 * Acknowledgements are ordered; a reorg invalidates overlapping receipts
 * before any replacement ack is accepted. A version change cannot continue
 * the current run — it seals or halts and asks for a new one.
 */

import type { FailureClass, FailureUnit, RetryState } from "./constraints.ts";
import type { CoverageRange } from "./constraints.ts";

export const RUNNER_STATUSES = [
	"pending",
	"running",
	"complete",
	"failed",
	"halted",
] as const;
export type RunnerStatus = (typeof RUNNER_STATUSES)[number];

export const RUNNER_EVENT_TYPES = [
	"start",
	"ack",
	"fail",
	"retry",
	"halt",
	"resume",
	"reorg",
	"version",
	"finish",
] as const;
export type RunnerEventType = (typeof RUNNER_EVENT_TYPES)[number];

export const DEFAULT_MAX_RETRIES = 3;

export type RunnerVersion = {
	code_hash: string;
	config_hash: string;
	handler_hash: string | null;
};

export type RunnerFailure = {
	unit_kind: FailureUnit;
	class: FailureClass;
	retry_state: Exclude<RetryState, "resolved">;
	from_height: number | null;
	to_height: number | null;
	error: string | null;
};

export type RunnerState = {
	stage_id: string;
	status: RunnerStatus;
	version: RunnerVersion;
	start_height: number;
	target_height: number | null;
	complete_through: number | null;
	last_acked_hash: string | null;
	retry_count: number;
	open_failure: RunnerFailure | null;
};

export type RunnerEvent =
	| { type: "start" }
	| {
			type: "ack";
			height: number;
			hash: string;
			input_count: number;
			input_digest: string;
			effect_digest: string;
	  }
	| {
			type: "fail";
			unit_kind: FailureUnit;
			class: FailureClass;
			from_height: number | null;
			to_height: number | null;
			error: string | null;
	  }
	| { type: "retry" }
	| { type: "halt" }
	| { type: "resume" }
	| { type: "reorg"; fork_point: number }
	| { type: "version"; version: RunnerVersion }
	| { type: "finish" };

export type RunnerEffect =
	| { type: "invalidate_receipts"; range: CoverageRange }
	| { type: "spawn_run"; version: RunnerVersion }
	| { type: "open_failure"; failure: RunnerFailure }
	| { type: "resolve_failure" };

export type RunnerResult =
	| { ok: true; state: RunnerState; effects: RunnerEffect[] }
	| { ok: false; reason: string; state: RunnerState };

export type TransitionRule = {
	from: RunnerStatus;
	event: RunnerEventType;
	to: RunnerStatus | "reject";
};

/**
 * Structural transition table. Guards (order, retry budget, version
 * equality, reorg overlap) are applied on top in `applyRunnerEvent`.
 */
export const RUNNER_TRANSITION_TABLE: readonly TransitionRule[] = [
	{ from: "pending", event: "start", to: "running" },
	{ from: "pending", event: "ack", to: "reject" },
	{ from: "pending", event: "fail", to: "reject" },
	{ from: "pending", event: "retry", to: "reject" },
	{ from: "pending", event: "halt", to: "reject" },
	{ from: "pending", event: "resume", to: "reject" },
	{ from: "pending", event: "reorg", to: "reject" },
	{ from: "pending", event: "version", to: "pending" },
	{ from: "pending", event: "finish", to: "reject" },

	{ from: "running", event: "start", to: "reject" },
	{ from: "running", event: "ack", to: "running" },
	{ from: "running", event: "fail", to: "failed" },
	{ from: "running", event: "retry", to: "reject" },
	{ from: "running", event: "halt", to: "halted" },
	{ from: "running", event: "resume", to: "running" },
	{ from: "running", event: "reorg", to: "running" },
	{ from: "running", event: "version", to: "halted" },
	{ from: "running", event: "finish", to: "complete" },

	{ from: "complete", event: "start", to: "reject" },
	{ from: "complete", event: "ack", to: "reject" },
	{ from: "complete", event: "fail", to: "reject" },
	{ from: "complete", event: "retry", to: "reject" },
	{ from: "complete", event: "halt", to: "reject" },
	{ from: "complete", event: "resume", to: "reject" },
	{ from: "complete", event: "reorg", to: "running" },
	{ from: "complete", event: "version", to: "complete" },
	{ from: "complete", event: "finish", to: "complete" },

	{ from: "failed", event: "start", to: "reject" },
	{ from: "failed", event: "ack", to: "reject" },
	{ from: "failed", event: "fail", to: "reject" },
	{ from: "failed", event: "retry", to: "running" },
	{ from: "failed", event: "halt", to: "halted" },
	{ from: "failed", event: "resume", to: "running" },
	{ from: "failed", event: "reorg", to: "failed" },
	{ from: "failed", event: "version", to: "halted" },
	{ from: "failed", event: "finish", to: "reject" },

	{ from: "halted", event: "start", to: "reject" },
	{ from: "halted", event: "ack", to: "reject" },
	{ from: "halted", event: "fail", to: "reject" },
	{ from: "halted", event: "retry", to: "running" },
	{ from: "halted", event: "halt", to: "halted" },
	{ from: "halted", event: "resume", to: "running" },
	{ from: "halted", event: "reorg", to: "halted" },
	{ from: "halted", event: "version", to: "halted" },
	{ from: "halted", event: "finish", to: "reject" },
];

const RULE_INDEX = new Map<string, TransitionRule>(
	RUNNER_TRANSITION_TABLE.map((rule) => [`${rule.from}:${rule.event}`, rule]),
);

export function lookupTransition(
	from: RunnerStatus,
	event: RunnerEventType,
): TransitionRule {
	const rule = RULE_INDEX.get(`${from}:${event}`);
	if (!rule) {
		throw new Error(`missing transition ${from} + ${event}`);
	}
	return rule;
}

export function versionsEqual(a: RunnerVersion, b: RunnerVersion): boolean {
	return (
		a.code_hash === b.code_hash &&
		a.config_hash === b.config_hash &&
		a.handler_hash === b.handler_hash
	);
}

/** Next height this run must acknowledge. */
export function expectedAckHeight(state: RunnerState): number {
	return state.complete_through === null
		? state.start_height
		: state.complete_through + 1;
}

export function createRunnerState(init: {
	stage_id: string;
	start_height: number;
	target_height?: number | null;
	version: RunnerVersion;
}): RunnerState {
	return {
		stage_id: init.stage_id,
		status: "pending",
		version: init.version,
		start_height: init.start_height,
		target_height: init.target_height ?? null,
		complete_through: null,
		last_acked_hash: null,
		retry_count: 0,
		open_failure: null,
	};
}

function ok(state: RunnerState, effects: RunnerEffect[] = []): RunnerResult {
	return { ok: true, state, effects };
}

function reject(state: RunnerState, reason: string): RunnerResult {
	return { ok: false, reason, state };
}

function clone(state: RunnerState, patch: Partial<RunnerState>): RunnerState {
	return { ...state, ...patch };
}

function rewind(
	state: RunnerState,
	forkPoint: number,
): { next: RunnerState; effects: RunnerEffect[] } {
	const from = Math.max(forkPoint, state.start_height);
	const through = state.complete_through;
	if (through === null || through < from) {
		return { next: state, effects: [] };
	}
	const completeThrough = from <= state.start_height ? null : from - 1;
	return {
		next: clone(state, {
			complete_through: completeThrough,
			last_acked_hash: null,
		}),
		effects: [
			{
				type: "invalidate_receipts",
				range: { from_height: from, to_height: through },
			},
		],
	};
}

function applyRetry(state: RunnerState, maxRetries: number): RunnerResult {
	if (state.retry_count >= maxRetries) {
		const failure = state.open_failure
			? { ...state.open_failure, retry_state: "halted" as const }
			: null;
		return ok(clone(state, { status: "halted", open_failure: failure }));
	}
	const failure = state.open_failure
		? { ...state.open_failure, retry_state: "retrying" as const }
		: null;
	return ok(
		clone(state, {
			status: "running",
			retry_count: state.retry_count + 1,
			open_failure: failure,
		}),
	);
}

export function applyRunnerEvent(
	state: RunnerState,
	event: RunnerEvent,
	opts?: { maxRetries?: number },
): RunnerResult {
	const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
	const rule = lookupTransition(state.status, event.type);
	if (rule.to === "reject") {
		return reject(state, `${state.status} cannot ${event.type}`);
	}
	const nextStatus = rule.to;

	switch (event.type) {
		case "start":
			return ok(clone(state, { status: "running" }));

		case "ack": {
			if (event.height === state.complete_through) {
				if (event.hash === state.last_acked_hash) return ok(state);
				return reject(
					state,
					`ack at ${event.height} has a different hash; reorg first`,
				);
			}
			const expected = expectedAckHeight(state);
			if (event.height !== expected) {
				return reject(
					state,
					`ack at ${event.height} skips ${expected}; acknowledgements must be ordered`,
				);
			}
			const effects: RunnerEffect[] = [];
			const failure = state.open_failure;
			const coversFailure =
				failure &&
				failure.from_height !== null &&
				event.height >= failure.from_height &&
				(failure.to_height === null || event.height <= failure.to_height);
			if (coversFailure) effects.push({ type: "resolve_failure" });
			return ok(
				clone(state, {
					status: "running",
					complete_through: event.height,
					last_acked_hash: event.hash,
					open_failure: coversFailure ? null : failure,
				}),
				effects,
			);
		}

		case "fail": {
			const failure: RunnerFailure = {
				unit_kind: event.unit_kind,
				class: event.class,
				retry_state: "open",
				from_height: event.from_height,
				to_height: event.to_height,
				error: event.error,
			};
			return ok(clone(state, { status: "failed", open_failure: failure }), [
				{ type: "open_failure", failure },
			]);
		}

		case "retry":
			return applyRetry(state, maxRetries);

		case "halt": {
			const failure = state.open_failure
				? { ...state.open_failure, retry_state: "halted" as const }
				: state.open_failure;
			return ok(clone(state, { status: "halted", open_failure: failure }));
		}

		case "resume":
			if (state.status === "running") return ok(state);
			if (state.open_failure) return applyRetry(state, maxRetries);
			return ok(clone(state, { status: "running" }));

		case "reorg": {
			if (event.fork_point < state.start_height) {
				return reject(
					state,
					`reorg fork ${event.fork_point} is below start ${state.start_height}`,
				);
			}
			const { next, effects } = rewind(state, event.fork_point);
			if (effects.length === 0) return ok(state);
			return ok(clone(next, { status: nextStatus }), effects);
		}

		case "version": {
			if (versionsEqual(state.version, event.version)) return ok(state);
			if (state.status === "pending") {
				return ok(clone(state, { version: event.version }));
			}
			const sealed: RunnerStatus =
				state.status === "complete" ? "complete" : "halted";
			return ok(clone(state, { status: sealed }), [
				{ type: "spawn_run", version: event.version },
			]);
		}

		case "finish": {
			if (state.status === "complete") return ok(state);
			if (state.target_height === null) {
				return reject(state, "cannot finish a follow-the-chain run");
			}
			if (
				state.complete_through === null ||
				state.complete_through < state.target_height
			) {
				return reject(
					state,
					`cannot finish: complete_through ${state.complete_through} is short of target ${state.target_height}`,
				);
			}
			return ok(clone(state, { status: "complete" }));
		}
	}
}
