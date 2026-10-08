/**
 * `POST /internal/failed-requests` — batched ingest of failed-request records
 * from the workload gateway. Hosted subgraph and webhook calls never pass
 * through the platform API, so the gateway ships its own error records here;
 * they back the 24h feedback evidence (`getFailedRequest`). Not a
 * customer-facing route.
 *
 * Guard is the same as `/internal/meters`: a constant-time compare against
 * `WORKLOAD_HOST_KEY`; an unset key authenticates nobody.
 *
 * Response is `{ accepted, skipped }`. `skipped` counts items whose account
 * does not exist (foreign-key violation). A duplicate `request_id` is a
 * silent no-op that still counts as accepted: `insertFailedRequest` cannot
 * report whether a row was written.
 */

import { insertFailedRequest } from "@secondlayer/platform/db/queries/api-failed-requests";
import { getDb } from "@secondlayer/shared/db";
import {
	type FailedRequestRecord,
	REQUEST_ID_PATTERN,
	normalizeOrigin,
} from "@secondlayer/shared/error-envelope";
import {
	AuthenticationError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { InvalidJSONError } from "../middleware/error.ts";
import { bearerToken, workloadHostKeyMatches } from "./internal-meters.ts";

export const MAX_FAILED_REQUEST_BATCH = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHODS = new Set([
	"GET",
	"HEAD",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"OPTIONS",
]);
const MAX_MESSAGE_CHARS = 200;
const MAX_QUERY_JSON_CHARS = 2048;

function parseItem(raw: unknown, index: number): FailedRequestRecord {
	if (typeof raw !== "object" || raw === null) {
		throw new ValidationError(`items[${index}] must be an object`);
	}
	const b = raw as Record<string, unknown>;
	if (
		typeof b.request_id !== "string" ||
		!REQUEST_ID_PATTERN.test(b.request_id)
	) {
		throw new ValidationError(`items[${index}].request_id is invalid`);
	}
	if (typeof b.account_id !== "string" || !UUID.test(b.account_id)) {
		throw new ValidationError(`items[${index}].account_id must be a UUID`);
	}
	if (typeof b.method !== "string" || !METHODS.has(b.method)) {
		throw new ValidationError(`items[${index}].method is invalid`);
	}
	if (
		typeof b.path !== "string" ||
		!b.path.startsWith("/") ||
		b.path.length > 512
	) {
		throw new ValidationError(
			`items[${index}].path must start with / and be at most 512 chars`,
		);
	}
	if (
		typeof b.status !== "number" ||
		!Number.isInteger(b.status) ||
		b.status < 400 ||
		b.status > 599
	) {
		throw new ValidationError(`items[${index}].status must be 400-599`);
	}
	if (typeof b.code !== "string" || b.code.length > 64) {
		throw new ValidationError(
			`items[${index}].code must be a string of at most 64 chars`,
		);
	}
	if (typeof b.message !== "string") {
		throw new ValidationError(`items[${index}].message must be a string`);
	}
	if (
		typeof b.query !== "object" ||
		b.query === null ||
		Array.isArray(b.query) ||
		JSON.stringify(b.query).length > MAX_QUERY_JSON_CHARS
	) {
		throw new ValidationError(
			`items[${index}].query must be an object of at most ${MAX_QUERY_JSON_CHARS} chars`,
		);
	}
	if (
		b.origin !== null &&
		(typeof b.origin !== "string" || normalizeOrigin(b.origin) === null)
	) {
		throw new ValidationError(`items[${index}].origin is invalid`);
	}
	return {
		request_id: b.request_id,
		account_id: b.account_id,
		method: b.method,
		path: b.path,
		status: b.status,
		code: b.code,
		message: b.message.slice(0, MAX_MESSAGE_CHARS),
		query: b.query as Record<string, unknown>,
		origin: b.origin as string | null,
	};
}

function pgCode(e: unknown): unknown {
	return (e as { code?: unknown }).code;
}

const app = new Hono();

app.post("/", async (c) => {
	const raw = bearerToken(c.req.header("authorization"));
	if (raw === null || !workloadHostKeyMatches(raw)) {
		throw new AuthenticationError("Missing or invalid Authorization header", {
			hint: "Send the workload host key as `Authorization: Bearer $WORKLOAD_HOST_KEY`.",
			env_var: "WORKLOAD_HOST_KEY",
		});
	}

	const body = await c.req.json().catch(() => {
		throw new InvalidJSONError();
	});
	if (
		typeof body !== "object" ||
		body === null ||
		!Array.isArray((body as { items?: unknown }).items)
	) {
		throw new ValidationError("body must be { items: [...] }");
	}
	const rawItems = (body as { items: unknown[] }).items;
	if (rawItems.length === 0) {
		throw new ValidationError("items must be a non-empty array");
	}
	if (rawItems.length > MAX_FAILED_REQUEST_BATCH) {
		return c.json(
			{
				error: `batch of ${rawItems.length} exceeds max ${MAX_FAILED_REQUEST_BATCH} items per call`,
			},
			413,
		);
	}
	const items = rawItems.map(parseItem);

	const db = getDb();
	let accepted = 0;
	let skipped = 0;
	for (const item of items) {
		try {
			await insertFailedRequest(db, item);
			accepted++;
		} catch (e) {
			// Unknown account: skip the item, keep the batch.
			if (pgCode(e) === "23503") {
				skipped++;
				continue;
			}
			throw e;
		}
	}
	return c.json({ accepted, skipped });
});

export default app;
