/**
 * `POST /internal/meters` — batched ingest for hosted-stack meters (044's
 * provisioner, 046's gateway): memory GB-hours, storage GB-days, webhook
 * events. Not a customer-facing route; a first-party workload host submits
 * a batch, each item becomes one `meter()` call.
 *
 * Guard mirrors `instanceTokenMatches` (`api/src/instance-bind.ts`): a
 * constant-time compare against `WORKLOAD_HOST_KEY`, and an unset key
 * authenticates nobody — every request 401s rather than silently accepting
 * an unauthenticated batch.
 *
 * Every item gets its own result (`ok`, `rejected` or `failed`); see `ItemResult`.
 * The response is 200 unless an item hit a transient failure (503: resend the
 * batch, replays are idempotent).
 *
 * `sentinel.*` units are retired: priced for history, never metered again
 * (Sentinel bills on its own Stripe subscriptions). `quantity` must be >= 0:
 * a negative quantity would write a negative ledger row and credit the account.
 */

import { timingSafeEqual } from "node:crypto";
import { meter } from "@secondlayer/platform/billing/meter";
import {
	MAX_METER_BATCH,
	PRICES,
	RETIRED_METER_UNITS,
} from "@secondlayer/platform/billing/prices";
import type { MeterUnit } from "@secondlayer/platform/billing/prices";
import { logger } from "@secondlayer/shared";
import { getDb } from "@secondlayer/shared/db";
import {
	AuthenticationError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { InvalidJSONError } from "../middleware/error.ts";

const VALID_UNITS = new Set<string>(Object.keys(PRICES));
/** Units that take new charges: priced, and not retired. */
const METERABLE_UNITS = [...VALID_UNITS].filter(
	(unit) => !RETIRED_METER_UNITS.has(unit as MeterUnit),
);

/** `occurredAt` bounds: a small forward tolerance for clock skew between the
 *  workload host and this server, and a floor matching the hosted-stack
 *  snapshot's own 35-day "ever ran" window (`usage-ledger.ts`) — nothing a
 *  real sample or retry should ever fall outside of. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_PAST_MS = 35 * 24 * 60 * 60 * 1000;

function isValidUnit(unit: unknown): unit is MeterUnit {
	return typeof unit === "string" && VALID_UNITS.has(unit);
}

/** Constant-time compare against `WORKLOAD_HOST_KEY`. False (never
 *  authenticates) when the env var is unset — an operator who never sets it
 *  gets a route that refuses every request, not one that's silently open. */
export function workloadHostKeyMatches(
	provided: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const expected = env.WORKLOAD_HOST_KEY?.trim();
	if (!expected || provided.length === 0) return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/** Exported so `internal-introspect.ts` reuses the exact same parse — one
 *  `Authorization: Bearer` convention for every first-party workload-host
 *  route, not a copy that can drift. */
export function bearerToken(header: string | undefined): string | null {
	if (!header?.startsWith("Bearer ")) return null;
	const raw = header.slice(7).trim();
	return raw.length > 0 ? raw : null;
}

type MeterItemInput = {
	accountId: string;
	unit: MeterUnit;
	quantity: number;
	/** Raw sampled quantity before any floor — `memory.gb_hour` only.
	 *  Optional; non-negative when present. */
	observedQuantity?: number;
	idempotencyKey: string;
	source?: string;
	occurredAt?: string;
};

function parseItem(raw: unknown, index: number): MeterItemInput {
	if (typeof raw !== "object" || raw === null) {
		throw new ValidationError(`items[${index}] must be an object`);
	}
	const body = raw as Record<string, unknown>;
	if (typeof body.accountId !== "string" || body.accountId.length === 0) {
		throw new ValidationError(`items[${index}].accountId is required`);
	}
	if (!isValidUnit(body.unit)) {
		throw new ValidationError(
			`items[${index}].unit must be one of ${METERABLE_UNITS.join(", ")}`,
		);
	}
	if (RETIRED_METER_UNITS.has(body.unit)) {
		throw new ValidationError(
			`items[${index}].unit ${body.unit} is retired and takes no new charges; use one of ${METERABLE_UNITS.join(", ")}`,
		);
	}
	if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity)) {
		throw new ValidationError(`items[${index}].quantity must be a number`);
	}
	if (body.quantity < 0) {
		throw new ValidationError(`items[${index}].quantity must not be negative`);
	}
	if (
		body.observedQuantity !== undefined &&
		(typeof body.observedQuantity !== "number" ||
			!Number.isFinite(body.observedQuantity) ||
			body.observedQuantity < 0)
	) {
		throw new ValidationError(
			`items[${index}].observedQuantity must be a non-negative number`,
		);
	}
	if (
		typeof body.idempotencyKey !== "string" ||
		body.idempotencyKey.length === 0
	) {
		throw new ValidationError(`items[${index}].idempotencyKey is required`);
	}
	if (body.occurredAt !== undefined) {
		if (typeof body.occurredAt !== "string") {
			throw new ValidationError(`items[${index}].occurredAt must be a string`);
		}
		const occurredAtMs = Date.parse(body.occurredAt);
		if (Number.isNaN(occurredAtMs)) {
			throw new ValidationError(
				`items[${index}].occurredAt must be a valid ISO date`,
			);
		}
		const now = Date.now();
		if (occurredAtMs > now + FUTURE_TOLERANCE_MS) {
			throw new ValidationError(
				`items[${index}].occurredAt must not be in the future`,
			);
		}
		if (occurredAtMs < now - MAX_PAST_MS) {
			throw new ValidationError(
				`items[${index}].occurredAt must not be more than 35 days old`,
			);
		}
	}
	if (body.source !== undefined && typeof body.source !== "string") {
		throw new ValidationError(`items[${index}].source must be a string`);
	}
	return {
		accountId: body.accountId,
		unit: body.unit,
		quantity: body.quantity,
		observedQuantity: body.observedQuantity as number | undefined,
		idempotencyKey: body.idempotencyKey,
		source: body.source,
		occurredAt: body.occurredAt,
	};
}

type ItemResult =
	| {
			status: "ok";
			idempotencyKey: string;
			accountId: string;
			unit: MeterUnit;
			usd_micros: number;
			debited: boolean;
			balance_after_usd_micros: number;
	  }
	| {
			/** Will never succeed as sent (bad input, unknown account, a ledger
			 *  CHECK): drop it. */
			status: "rejected";
			idempotencyKey: string | null;
			error: string;
	  }
	| {
			/** A transient failure: resend (safe, idempotent). */
			status: "failed";
			idempotencyKey: string;
			error: string;
	  };

/** An error no resend can fix: a ledger invariant `meter()` asserts, or a
 *  Postgres data error (class 22: malformed id) or integrity violation
 *  (class 23: unknown account FK, CHECK, ...). */
function isPermanentItemError(err: unknown): boolean {
	if (err instanceof Error && err.message.startsWith("meter:")) return true;
	const code = (err as { code?: unknown } | null)?.code;
	return (
		typeof code === "string" && (code.startsWith("22") || code.startsWith("23"))
	);
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
	if (rawItems.length > MAX_METER_BATCH) {
		return c.json(
			{
				error: `batch of ${rawItems.length} exceeds max ${MAX_METER_BATCH} items per call`,
			},
			413,
		);
	}
	const db = getDb();
	// One bad item never fails the batch: each item parses and meters on its
	// own and gets its own result, so the caller drops what was rejected and
	// resends only what failed. Replays are safe either way (idempotency key).
	const results = await Promise.all(
		rawItems.map(async (raw, index): Promise<ItemResult> => {
			const rawKey = (raw as { idempotencyKey?: unknown } | null)
				?.idempotencyKey;
			const idempotencyKey = typeof rawKey === "string" ? rawKey : null;
			let item: MeterItemInput;
			try {
				item = parseItem(raw, index);
			} catch (err) {
				if (err instanceof ValidationError) {
					return {
						status: "rejected",
						idempotencyKey,
						error: err.message,
					};
				}
				throw err;
			}
			try {
				const result = await meter(db, {
					accountId: item.accountId,
					unit: item.unit,
					quantity: item.quantity,
					observedQuantity: item.observedQuantity,
					source: item.source ?? "internal:workload-host",
					idempotencyKey: item.idempotencyKey,
					occurredAt: item.occurredAt ? new Date(item.occurredAt) : undefined,
				});
				return {
					status: "ok",
					idempotencyKey: item.idempotencyKey,
					accountId: item.accountId,
					unit: item.unit,
					usd_micros: Number(result.usdMicros),
					debited: result.debited,
					balance_after_usd_micros: Number(result.balanceAfter),
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (isPermanentItemError(err)) {
					return {
						status: "rejected",
						idempotencyKey: item.idempotencyKey,
						error: message,
					};
				}
				logger.error("internal meters: item failed, caller should resend", {
					idempotencyKey: item.idempotencyKey,
					error: message,
				});
				return {
					status: "failed",
					idempotencyKey: item.idempotencyKey,
					error: message,
				};
			}
		}),
	);

	// Only a transient failure asks the caller to resend; rejected items never
	// will succeed and are reported, not retried.
	const failed = results.some((r) => r.status === "failed");
	return c.json({ results }, failed ? 503 : 200);
});

export default app;
