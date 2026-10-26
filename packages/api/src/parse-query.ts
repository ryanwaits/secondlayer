// Canonical home for /v1 query-param validators shared by the index and
// streams surfaces. Keep these byte-for-byte conservative: they gate the
// frozen 1.0 envelope, so error strings here are part of the contract.
import { ValidationError } from "@secondlayer/shared/errors";
import {
	type StreamsCursorInput,
	decodeStreamsCursor,
} from "./streams/cursor.ts";

export function parseNonNegativeInteger(value: string, name: string): number {
	if (!/^(0|[1-9]\d*)$/.test(value)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) {
		throw new ValidationError(`${name} must be a non-negative integer`);
	}

	return parsed;
}

/** `?limit=` → positive integer capped at 1000; absent → `defaultLimit`. */
export function parseLimit(
	value: string | undefined,
	defaultLimit: number,
): number {
	if (value === undefined) return defaultLimit;
	const parsed = /^[1-9]\d*$/.test(value) ? Number(value) : Number.NaN;
	if (!Number.isSafeInteger(parsed)) {
		throw new ValidationError("limit must be a positive integer");
	}
	return Math.min(1000, parsed);
}

/** Lenient page size for non-/v1 routes: garbage or <1 → `defaultLimit`,
 *  capped at `max`. /v1 index and streams reads use strict `parseLimit`. */
export function clampLimit(
	value: string | undefined,
	defaultLimit: number,
	max: number,
): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Math.min(max, parsed >= 1 ? parsed : defaultLimit);
}

/** Lenient offset for non-/v1 routes: garbage or negative → 0. */
export function clampOffset(value: string | undefined): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return parsed > 0 ? parsed : 0;
}

export function parseCursor(value: string): StreamsCursorInput {
	try {
		return decodeStreamsCursor(value);
	} catch {
		throw new ValidationError("cursor must use <block_height>:<event_index>");
	}
}
