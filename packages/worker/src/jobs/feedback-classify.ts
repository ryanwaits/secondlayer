/**
 * Hosted only (no-op outside platform mode). Nothing here deletes, hides or
 * closes a ticket: every route is a visible queue, and a classifier failure
 * or refusal fails open to `human`. Until the eval gate documented on
 * `MODEL_ROUTING_ENABLED` passes, `low_priority` comes from rules only.
 *
 * Concurrency: `FOR UPDATE SKIP LOCKED` splits the batch across replicas (no
 * leader lock). The classify call (<= CLASSIFY_TIMEOUT_MS) runs while the row
 * lock is held, which is fine at hosted feedback volume; past a few hundred
 * tickets/hour switch to claim-then-release.
 *
 * Never logs ticket intent, expected or evidence.
 */

import { getErrorMessage, logger } from "@secondlayer/shared";
import { classify, resolveProvider } from "@secondlayer/shared/classify";
import {
	FEEDBACK_TICKET_STATUSES,
	type FeedbackTicket,
	type FeedbackTicketStatus,
	getDb,
	jsonb,
} from "@secondlayer/shared/db";
import {
	casTransition,
	defineMachine,
} from "@secondlayer/shared/db/transition";
import { getInstanceMode } from "@secondlayer/shared/mode";
import { scheduleCron } from "./cron-schedule.ts";
import {
	FEEDBACK_QUESTIONS,
	FEEDBACK_SCHEMA_VERSION,
	type FeedbackTicketInput,
	buildFeedbackState,
	route,
	rulesFor,
} from "./feedback-classify-core.ts";

/** A ticket is classified once and never returns to `new`. */
export const FEEDBACK_TICKET_MACHINE = defineMachine({
	states: FEEDBACK_TICKET_STATUSES,
	transitions: {
		new: ["classified"],
	},
});

const INTERVAL_MS = 60_000;
const BATCH_MAX = 50;
const CLASSIFY_TIMEOUT_MS = 5_000;

export type ClassifyDeps = {
	classifyFn: typeof classify;
	resolveProviderFn: typeof resolveProvider;
};

const DEFAULT_DEPS: ClassifyDeps = {
	classifyFn: classify,
	resolveProviderFn: resolveProvider,
};

export async function classifyNewTickets(
	opts: { limit?: number; now?: Date; deps?: ClassifyDeps } = {},
): Promise<number> {
	const limit = opts.limit ?? BATCH_MAX;
	const deps = opts.deps ?? DEFAULT_DEPS;
	let routed = 0;
	for (let i = 0; i < limit; i++) {
		try {
			if (!(await classifyOne(opts.now ?? new Date(), deps))) break;
			routed++;
		} catch (err) {
			// Database-level failure: stop instead of spinning the whole batch.
			logger.warn("Feedback classify batch aborted", {
				error: getErrorMessage(err),
			});
			break;
		}
	}
	return routed;
}

type Claimed = Pick<
	FeedbackTicket,
	"intent" | "expected" | "kind_hint" | "evidence" | "attempted" | "origin"
> & { id: string };

async function decide(row: Claimed, deps: ClassifyDeps) {
	try {
		const ticket: FeedbackTicketInput = {
			id: row.id,
			intent: row.intent,
			expected: row.expected,
			kind_hint: row.kind_hint,
			evidence: row.evidence as FeedbackTicketInput["evidence"],
			attempted: row.attempted as FeedbackTicketInput["attempted"],
			origin: row.origin,
		};
		const rules = rulesFor(ticket);

		const result =
			rules === null && deps.resolveProviderFn(process.env).name !== "rules"
				? await deps.classifyFn({
						state: buildFeedbackState(ticket),
						questions: FEEDBACK_QUESTIONS,
						timeoutMs: CLASSIFY_TIMEOUT_MS,
					})
				: null;

		const decision = route({
			ticket,
			rules,
			provider: result?.provider ?? null,
			answers: result?.answers ?? null,
		});
		return {
			route: decision.route,
			classification: {
				provider: result?.provider ?? null,
				modelId: result?.modelId ?? null,
				answers: result?.answers ?? null,
				rules_hit: rules?.rule ?? null,
				kind: decision.kind,
				reason: decision.reason,
			},
		};
	} catch (err) {
		logger.warn("Failed to classify feedback ticket", {
			ticketId: row.id,
			error: getErrorMessage(err),
		});
		return {
			route: "human" as const,
			classification: {
				provider: null,
				modelId: null,
				answers: null,
				rules_hit: null,
				kind: null,
				reason: "job_error",
			},
		};
	}
}

async function classifyOne(now: Date, deps: ClassifyDeps): Promise<boolean> {
	const db = getDb();
	return db.transaction().execute(async (tx) => {
		const row = await tx
			.selectFrom("feedback_tickets")
			.select([
				"id",
				"intent",
				"expected",
				"kind_hint",
				"evidence",
				"attempted",
				"origin",
			])
			.where("status", "=", "new")
			.orderBy("created_at", "asc")
			.limit(1)
			.forUpdate()
			.skipLocked()
			.executeTakeFirst();
		if (!row) return false;

		const outcome = await decide(row, deps);

		FEEDBACK_TICKET_MACHINE.assert("new", "classified");
		const classified = await casTransition<FeedbackTicketStatus>(tx, {
			table: "feedback_tickets",
			id: row.id,
			from: ["new"],
			to: "classified",
			stampUpdatedAt: false,
			returning: ["id"],
			set: {
				route: outcome.route,
				classified_at: now,
				classification: jsonb<Record<string, unknown>>({
					schema_version: FEEDBACK_SCHEMA_VERSION,
					...outcome.classification,
				}),
			},
		});
		if (!classified) {
			logger.warn("Feedback ticket was no longer new", { ticketId: row.id });
			return false;
		}
		return true;
	});
}

export function startFeedbackClassifyCron(): () => void {
	if (getInstanceMode() !== "platform") {
		logger.info("Feedback classify cron skipped (not platform mode)");
		return () => {};
	}

	let inFlight = false;
	const tick = async () => {
		if (inFlight) return;
		inFlight = true;
		try {
			await classifyNewTickets();
		} catch (err) {
			logger.error("Feedback classify cron error", {
				error: getErrorMessage(err),
			});
		} finally {
			inFlight = false;
		}
	};

	return scheduleCron(tick, 60_000, INTERVAL_MS);
}
