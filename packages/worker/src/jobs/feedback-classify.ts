/**
 * Feedback ticket labeller: every minute, claims `status = 'new'` rows from
 * `feedback_tickets` and routes each to a review queue. Deterministic rules
 * run first; only an undecided ticket goes to the shared classifier
 * (`CLASSIFIER=jev|kev|clef|rules`). The full classifier output is stored on
 * the ticket so agreement with human labels can be measured.
 *
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
import { getDb, jsonb } from "@secondlayer/shared/db";
import { getInstanceMode } from "@secondlayer/shared/mode";
import {
	FEEDBACK_QUESTIONS,
	FEEDBACK_SCHEMA_VERSION,
	type FeedbackTicketInput,
	buildFeedbackState,
	route,
	rulesFor,
} from "./feedback-classify-core.ts";

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

/** Claims and routes up to `limit` new tickets, one short transaction each.
 *  Returns how many were routed. */
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
			logger.warn("Failed to classify feedback ticket", {
				error: getErrorMessage(err),
			});
		}
	}
	return routed;
}

/** Returns false when no unclaimed new ticket is left. */
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

		// With no model configured the ticket goes to human/fail_open.
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

		await tx
			.updateTable("feedback_tickets")
			.set({
				status: "classified",
				route: decision.route,
				classified_at: now,
				classification: jsonb<Record<string, unknown>>({
					schema_version: FEEDBACK_SCHEMA_VERSION,
					provider: result?.provider ?? null,
					modelId: result?.modelId ?? null,
					answers: result?.answers ?? null,
					rules_hit: rules?.rule ?? null,
					kind: decision.kind,
					reason: decision.reason,
				}),
			})
			.where("id", "=", row.id)
			.execute();
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

	const initial = setTimeout(tick, 60_000);
	const interval = setInterval(tick, INTERVAL_MS);

	return () => {
		clearTimeout(initial);
		clearInterval(interval);
	};
}
