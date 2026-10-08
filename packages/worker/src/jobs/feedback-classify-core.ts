/**
 * Pure core of the feedback classify job: state, questions, deterministic
 * rules and the routing policy. No IO (no db, fetch or model calls) so every
 * decision is unit-testable with plain objects.
 *
 * Privacy: the state sent to a model carries only codes, method, path,
 * status, query param NAMES, capped agent text and public chain ids. Never
 * query values, never request or response bodies.
 */

import type {
	Answer,
	ClassifierName,
	Question,
} from "@secondlayer/shared/classify";

export const FEEDBACK_SCHEMA_VERSION = 1 as const;

/** Narrow, IO-free view of a feedback_tickets row. */
export type FeedbackTicketInput = {
	id: string;
	intent: string;
	expected: Record<string, unknown> | null;
	kind_hint: string | null;
	evidence: {
		tx_id?: string;
		block_height?: number;
		contract_id?: string;
		event_type?: string;
		subgraph?: string;
		table?: string;
	} | null;
	attempted: {
		method?: string;
		path?: string;
		status?: number;
		code?: string;
		query?: Record<string, unknown>;
		origin?: string;
	} | null;
	origin: string | null;
};

export const FEEDBACK_KINDS = {
	missing_capability:
		"caller asked for an endpoint, filter, tool or field the API does not expose",
	bug: "the surface exists but returned a wrong row, value or status",
	schema_gap: "the on-chain data exists but no table or column carries it",
	docs_mismatch:
		"docs, OpenAPI or MCP descriptions disagree with what the API actually does",
	perf: "the answer was right but too slow or took too many calls",
	not_a_ticket:
		"caller misuse, auth or billing, or a query the API already supports",
} as const;
export type FeedbackKind = keyof typeof FEEDBACK_KINDS;

export const FEEDBACK_QUESTIONS = {
	kind: {
		type: "choice",
		instructions: "What kind of feedback is this API ticket?",
		criteria: FEEDBACK_KINDS,
	},
	risk: {
		type: "score",
		instructions:
			"If we changed the product to address this, how risky is the change?",
		criteria: [
			"safe: docs or description text only",
			"review: additive API or subgraph change a human should check",
			"dangerous: decode, reorg, tip following, backfill or chain-data correctness",
		],
	},
	has_chain_evidence: {
		type: "boolean",
		instructions:
			"Does the ticket carry enough chain evidence to reproduce it (tx id plus event type or block height, and an expected value)?",
		criteria: {
			true: "a reproducible on-chain reference is present",
			false: "no concrete on-chain reference",
		},
	},
} as const satisfies Record<string, Question>;

export const ROUTES = [
	"human",
	"docs",
	"schema_gap",
	"decode_fixture",
	"low_priority",
] as const;
export type Route = (typeof ROUTES)[number];

export const INTENT_MAX = 500;
export const EXPECTED_MAX = 1000;

export function buildFeedbackState(t: FeedbackTicketInput) {
	return {
		intent: t.intent.slice(0, INTENT_MAX),
		kind_hint: t.kind_hint,
		expected: t.expected
			? JSON.stringify(t.expected).slice(0, EXPECTED_MAX)
			: null,
		attempted: t.attempted
			? {
					method: t.attempted.method ?? null,
					path: t.attempted.path ?? null,
					status: t.attempted.status ?? null,
					code: t.attempted.code ?? null,
					query_params: t.attempted.query
						? Object.keys(t.attempted.query).sort()
						: [],
				}
			: null,
		evidence: t.evidence ?? null,
		surface: t.origin ?? t.attempted?.origin ?? null,
	};
}

const AUTH_CODES = new Set([
	"AUTHENTICATION_ERROR",
	"AUTHORIZATION_ERROR",
	"FORBIDDEN",
	"KEY_ROTATED",
	"GHOST_KEY_READ_ONLY",
]);
const MISSING_COLUMN_CODES = new Set(["INVALID_COLUMN", "TABLE_NOT_FOUND"]);

export type RuleHit = { kind: FeedbackKind; route: Route; rule: string };

/** Deterministic rules, first match wins. null = undecided, ask the model.
 *  New rules come from labelled data, not guesses. */
export function rulesFor(t: FeedbackTicketInput): RuleHit | null {
	const a = t.attempted;
	if (
		a &&
		(a.status === 401 ||
			a.status === 403 ||
			(a.code !== undefined && AUTH_CODES.has(a.code)))
	) {
		return { kind: "not_a_ticket", route: "low_priority", rule: "auth" };
	}
	if (a?.code !== undefined && MISSING_COLUMN_CODES.has(a.code)) {
		return { kind: "schema_gap", route: "schema_gap", rule: "missing_column" };
	}
	if (t.kind_hint === "bug" && t.evidence?.tx_id) {
		return { kind: "bug", route: "decode_fixture", rule: "bug_with_tx" };
	}
	return null;
}

/** Kind confidence needed before the model's kind picks a queue. Per
 *  provider because calibration differs (kev: fitted temperature; jev: RLCD;
 *  clef: its own). kev/clef values are PLACEHOLDERS: tune them with
 *  scripts/ops/classifier-compare.ts on labelled tickets before trusting. */
export const KIND_CONFIDENCE_MIN: Record<ClassifierName, number> = {
	jev: 0.85,
	kev: 0.85,
	clef: 0.85,
	rules: 1,
};
/** risk is a 0-based mean over [safe, review, dangerous]; >= 1.5 leans dangerous. */
export const RISK_DANGEROUS_MIN = 1.5;
export const CHAIN_EVIDENCE_MIN = 0.5;
/**
 * The model may lower a ticket to low_priority only after the eval gate:
 *   1. bun scripts/ops/feedback-queue.ts --status classified --since 30 --jsonl > feedback-label.jsonl
 *   2. a human fills labels.kind on >= 50 lines
 *   3. bun scripts/ops/classifier-compare.ts --questions
 *      packages/worker/src/jobs/feedback-classify-core.ts#FEEDBACK_QUESTIONS
 *      --input feedback-label.jsonl --providers jev,kev,clef
 *   4. go if kind agreement >= 0.85 at the provider's KIND_CONFIDENCE_MIN.
 * Flip in its own commit quoting the numbers (and update the
 * "never low_priority" test). Never an env var.
 */
export const MODEL_ROUTING_ENABLED = false;

export type RouteDecision = {
	route: Route;
	reason: string;
	kind: FeedbackKind | null;
};

function asKind(v: string): FeedbackKind | null {
	return Object.prototype.hasOwnProperty.call(FEEDBACK_KINDS, v)
		? (v as FeedbackKind)
		: null;
}

/** Pure routing policy. The model can only choose among visible queues;
 *  nothing here hides or closes a ticket. */
export function route(input: {
	ticket: FeedbackTicketInput;
	rules: RuleHit | null;
	provider: ClassifierName | null;
	answers: { kind: Answer; risk: Answer; has_chain_evidence: Answer } | null;
}): RouteDecision {
	const { ticket, rules, provider, answers } = input;
	if (rules) {
		return {
			route: rules.route,
			reason: `rule:${rules.rule}`,
			kind: rules.kind,
		};
	}
	if (!answers || !provider) {
		return { route: "human", reason: "fail_open", kind: null };
	}
	const { kind, risk, has_chain_evidence: evidence } = answers;
	if (
		kind.type !== "choice" ||
		risk.type !== "score" ||
		evidence.type !== "boolean"
	) {
		return { route: "human", reason: "refusal", kind: null };
	}
	const choice = asKind(kind.choice);
	if (risk.score >= RISK_DANGEROUS_MIN) {
		return { route: "human", reason: "dangerous", kind: choice };
	}
	if (kind.confidence < KIND_CONFIDENCE_MIN[provider]) {
		return { route: "human", reason: "low_confidence", kind: choice };
	}
	switch (kind.choice) {
		case "docs_mismatch":
			return { route: "docs", reason: "model:docs_mismatch", kind: choice };
		case "schema_gap":
			return { route: "schema_gap", reason: "model:schema_gap", kind: choice };
		case "bug":
			return evidence.probability >= CHAIN_EVIDENCE_MIN &&
				ticket.evidence?.tx_id
				? { route: "decode_fixture", reason: "model:bug", kind: choice }
				: { route: "human", reason: "bug_without_evidence", kind: choice };
		case "not_a_ticket":
			return MODEL_ROUTING_ENABLED
				? { route: "low_priority", reason: "model:not_a_ticket", kind: choice }
				: { route: "human", reason: "model_routing_disabled", kind: choice };
		default:
			return { route: "human", reason: `kind:${kind.choice}`, kind: choice };
	}
}
