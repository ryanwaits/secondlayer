/**
 * Queue coverage — subscription decision, outbox, delivery, rollback,
 * DLQ, and replay with cursor fences.
 */

import type { QueueCounters } from "./evaluate.ts";

export const QUEUE_STAGES = [
	"decision",
	"outbox",
	"delivery",
	"rollback",
	"dlq",
	"replay",
] as const;
export type QueueStage = (typeof QUEUE_STAGES)[number];

export type QueueEvent =
	| { type: "accept" }
	| { type: "decide"; matched: boolean }
	| { type: "enqueue" }
	| { type: "deliver" }
	| { type: "fail" }
	| { type: "dead" }
	| { type: "requeue" }
	| { type: "rollback" }
	| { type: "replay"; cursor: string };

export type QueueState = QueueCounters & {
	stage: QueueStage;
	last_cursor: string | null;
	dedupe: Set<string>;
};

export function emptyQueueState(): QueueState {
	return {
		stage: "decision",
		accepted: 0,
		decided: 0,
		enqueued: 0,
		delivered: 0,
		dead: 0,
		fence_cursor: null,
		last_cursor: null,
		dedupe: new Set(),
	};
}

export type QueueApply =
	| { ok: true; state: QueueState }
	| { ok: false; reason: string; state: QueueState };

export function applyQueueEvent(
	state: QueueState,
	event: QueueEvent,
	dedupeKey?: string,
): QueueApply {
	if (dedupeKey && state.dedupe.has(dedupeKey)) {
		return { ok: true, state };
	}
	const next: QueueState = {
		...state,
		dedupe: new Set(state.dedupe),
	};
	if (dedupeKey) next.dedupe.add(dedupeKey);

	switch (event.type) {
		case "accept":
			next.accepted += 1;
			next.stage = "decision";
			return { ok: true, state: next };
		case "decide":
			if (next.decided >= next.accepted) {
				return { ok: false, reason: "decide without accept", state };
			}
			next.decided += 1;
			next.stage = event.matched ? "outbox" : "decision";
			return { ok: true, state: next };
		case "enqueue":
			if (next.enqueued >= next.decided) {
				return { ok: false, reason: "enqueue without decide", state };
			}
			next.enqueued += 1;
			next.stage = "outbox";
			return { ok: true, state: next };
		case "deliver":
			if (next.delivered + next.dead >= next.enqueued) {
				return { ok: false, reason: "deliver without enqueue", state };
			}
			next.delivered += 1;
			next.stage = "delivery";
			return { ok: true, state: next };
		case "fail":
			next.stage = "delivery";
			return { ok: true, state: next };
		case "dead":
			if (next.delivered + next.dead >= next.enqueued) {
				return { ok: false, reason: "dead without enqueue", state };
			}
			next.dead += 1;
			next.stage = "dlq";
			return { ok: true, state: next };
		case "requeue":
			if (next.dead < 1)
				return { ok: false, reason: "requeue empty dlq", state };
			next.dead -= 1;
			next.enqueued += 1;
			next.stage = "outbox";
			return { ok: true, state: next };
		case "rollback":
			next.stage = "rollback";
			return { ok: true, state: next };
		case "replay":
			next.stage = "replay";
			next.last_cursor = event.cursor;
			next.fence_cursor = event.cursor;
			return { ok: true, state: next };
	}
}

export function queueCaughtUp(state: QueueState): boolean {
	return (
		state.accepted === state.decided &&
		state.delivered + state.dead === state.enqueued
	);
}
