/**
 * Hosted problem reports. An agent whose call failed sends back the
 * `request_id` from the error body plus one line of intent.
 *
 *   POST /v1/feedback  { intent, request_id?, kind_hint?, expected?, evidence? }
 *
 * Mounted only in platform mode (self-hosted error bodies link to a GitHub
 * issue instead). `attempted` is the server's own record of the failed call
 * from `api_failed_requests` (this account, last 24h), never caller input:
 * unknown top-level keys are refused so payloads and chain data stay out.
 * A `request_id` that is unknown, expired or another account's behaves the
 * same: `attempted` is null and `request_matched` is false.
 */

import { getFailedRequest } from "@secondlayer/platform/db/queries/api-failed-requests";
import { getDb, jsonb, parseJsonb } from "@secondlayer/shared/db";
import { REQUEST_ID_PATTERN } from "@secondlayer/shared/error-envelope";
import {
	AuthenticationError,
	RateLimitError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
import { getAccountId } from "../lib/ownership.ts";
import { InvalidJSONError } from "../middleware/error.ts";

export const FEEDBACK_KINDS = [
	"missing_capability",
	"bug",
	"schema_gap",
	"docs_mismatch",
	"perf",
] as const;
export const MAX_INTENT = 2000;
export const MAX_EXPECTED_BYTES = 4096;
export const MAX_BODY_BYTES = 16_384;
export const MAX_IDEMPOTENCY_KEY = 128;

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const EVIDENCE_WINDOW_MS = 24 * 3600_000;
const VALID_ORIGINS = new Set(["cli", "mcp", "session"]);

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export type FeedbackEvidence = {
	tx_id?: string;
	block_height?: number;
	contract_id?: string;
	event_type?: string;
	subgraph?: string;
	table?: string;
};

export type FeedbackInput = {
	intent: string;
	request_id: string | null;
	kind_hint: FeedbackKind | null;
	expected: Record<string, unknown> | null;
	evidence: FeedbackEvidence | null;
};

type Parsed<T> = { ok: T } | { error: string };

const ALLOWED_KEYS = new Set([
	"intent",
	"request_id",
	"kind_hint",
	"expected",
	"evidence",
]);

/** Max length per string evidence field. */
const EVIDENCE_STRING_MAX = {
	tx_id: 128,
	contract_id: 160,
	event_type: 64,
	subgraph: 64,
	table: 64,
} as const;

/** Trimmed string within bounds, null when absent/blank, undefined when invalid. */
function text(value: unknown, max: number): string | null | undefined {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	return trimmed.length > max ? undefined : trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvidence(value: unknown): Parsed<FeedbackEvidence | null> {
	if (!isPlainObject(value)) return { error: "evidence must be an object" };
	const out: FeedbackEvidence = {};
	for (const [key, raw] of Object.entries(value)) {
		if (raw === undefined) continue;
		if (key === "block_height") {
			if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
				return {
					error: "evidence.block_height must be a non-negative integer",
				};
			}
			out.block_height = raw;
			continue;
		}
		if (!Object.prototype.hasOwnProperty.call(EVIDENCE_STRING_MAX, key)) {
			return { error: `unknown evidence field: ${key}` };
		}
		const max = EVIDENCE_STRING_MAX[key as keyof typeof EVIDENCE_STRING_MAX];
		if (typeof raw !== "string" || raw.length === 0 || raw.length > max) {
			return {
				error: `evidence.${key} must be a non-empty string of at most ${max} characters`,
			};
		}
		out[key as keyof typeof EVIDENCE_STRING_MAX] = raw;
	}
	return { ok: Object.keys(out).length > 0 ? out : null };
}

/** Validates a report body, or names the bad field. */
export function parseFeedback(
	body: Record<string, unknown>,
): Parsed<FeedbackInput> {
	for (const key of Object.keys(body)) {
		if (!ALLOWED_KEYS.has(key)) return { error: `unknown field: ${key}` };
	}

	const intent = text(body.intent, MAX_INTENT);
	if (intent === undefined) {
		return {
			error: `intent must be a string of at most ${MAX_INTENT} characters`,
		};
	}
	if (!intent) return { error: "intent is required" };

	let requestId: string | null = null;
	if (body.request_id !== undefined && body.request_id !== null) {
		if (
			typeof body.request_id !== "string" ||
			!REQUEST_ID_PATTERN.test(body.request_id)
		) {
			return { error: "request_id is not a valid request id" };
		}
		requestId = body.request_id;
	}

	let kindHint: FeedbackKind | null = null;
	if (body.kind_hint !== undefined && body.kind_hint !== null) {
		if (!FEEDBACK_KINDS.includes(body.kind_hint as FeedbackKind)) {
			return {
				error: `kind_hint must be one of: ${FEEDBACK_KINDS.join(", ")}`,
			};
		}
		kindHint = body.kind_hint as FeedbackKind;
	}

	let expected: Record<string, unknown> | null = null;
	if (body.expected !== undefined && body.expected !== null) {
		if (!isPlainObject(body.expected)) {
			return { error: "expected must be an object" };
		}
		if (JSON.stringify(body.expected).length > MAX_EXPECTED_BYTES) {
			return {
				error: `expected is too large (${MAX_EXPECTED_BYTES} characters max)`,
			};
		}
		expected = body.expected;
	}

	let evidence: FeedbackEvidence | null = null;
	if (body.evidence !== undefined && body.evidence !== null) {
		const parsed = parseEvidence(body.evidence);
		if ("error" in parsed) return parsed;
		evidence = parsed.ok;
	}

	return {
		ok: {
			intent,
			request_id: requestId,
			kind_hint: kindHint,
			expected,
			evidence,
		},
	};
}

/** Absent header → null. Otherwise 1..128 printable ASCII, no spaces. */
export function parseIdempotencyKey(
	header: string | undefined,
): Parsed<string | null> {
	if (header === undefined) return { ok: null };
	if (
		header.length < 1 ||
		header.length > MAX_IDEMPOTENCY_KEY ||
		!/^[\x21-\x7E]+$/.test(header)
	) {
		return {
			error: `Idempotency-Key must be 1 to ${MAX_IDEMPOTENCY_KEY} printable characters without spaces`,
		};
	}
	return { ok: header };
}

export function createFeedbackRouter(opts?: { getDb?: typeof getDb }) {
	const app = new Hono();
	const resolveDb = opts?.getDb ?? getDb;

	app.post("/", async (c) => {
		const accountId = getAccountId(c);
		if (!accountId) {
			throw new AuthenticationError("Missing or invalid Authorization header");
		}

		const limit = await getRateLimitStore().check(
			`feedback:${accountId}`,
			RATE_LIMIT,
			RATE_WINDOW_MS,
		);
		if (!limit.allowed) {
			c.header("Retry-After", String(limit.retryAfter));
			throw new RateLimitError("Rate limit exceeded");
		}

		const raw = await c.req.text();
		if (raw.length > MAX_BODY_BYTES) {
			throw new ValidationError("body too large (16 KB max)");
		}
		let body: unknown;
		try {
			body = JSON.parse(raw);
		} catch {
			throw new InvalidJSONError();
		}
		if (!isPlainObject(body)) {
			throw new ValidationError("body must be a JSON object");
		}

		const key = parseIdempotencyKey(c.req.header("idempotency-key"));
		if ("error" in key) throw new ValidationError(key.error);
		const parsed = parseFeedback(body);
		if ("error" in parsed) throw new ValidationError(parsed.error);
		const input = parsed.ok;

		const db = resolveDb();

		let attempted: Record<string, unknown> | null = null;
		if (input.request_id) {
			const failed = await getFailedRequest(db, accountId, input.request_id);
			if (
				failed &&
				Date.now() - failed.created_at.getTime() <= EVIDENCE_WINDOW_MS
			) {
				attempted = {
					method: failed.method,
					path: failed.path,
					status: failed.status,
					code: failed.code,
					message: failed.message,
					query: parseJsonb(failed.query),
					origin: failed.origin,
					at: failed.created_at.toISOString(),
				};
			}
		}

		const rawOrigin = c.req.header("x-sl-origin")?.toLowerCase() ?? "";
		const origin = VALID_ORIGINS.has(rawOrigin) ? rawOrigin : "api";

		const inserted = await db
			.insertInto("feedback_tickets")
			.values({
				account_id: accountId,
				idempotency_key: key.ok,
				request_id: input.request_id,
				intent: input.intent,
				expected: input.expected
					? jsonb<Record<string, unknown>>(input.expected)
					: null,
				kind_hint: input.kind_hint,
				evidence: input.evidence
					? jsonb<Record<string, unknown>>(input.evidence)
					: null,
				attempted: attempted ? jsonb<Record<string, unknown>>(attempted) : null,
				origin,
			})
			.onConflict((oc) =>
				oc.columns(["account_id", "idempotency_key"]).doNothing(),
			)
			.returning("id")
			.executeTakeFirst();

		if (inserted) {
			return c.json(
				{
					id: inserted.id,
					status: "accepted",
					request_matched: attempted !== null,
				},
				202,
			);
		}

		// Only reachable with a non-null key: NULL keys never conflict.
		const existing = await db
			.selectFrom("feedback_tickets")
			.select(["id", "attempted"])
			.where("account_id", "=", accountId)
			.where("idempotency_key", "=", key.ok)
			.executeTakeFirstOrThrow();
		return c.json(
			{
				id: existing.id,
				status: "duplicate",
				request_matched: existing.attempted !== null,
			},
			202,
		);
	});

	return app;
}

export default createFeedbackRouter();
