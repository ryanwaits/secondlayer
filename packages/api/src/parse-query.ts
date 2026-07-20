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

export function parseCursor(value: string): StreamsCursorInput {
	try {
		return decodeStreamsCursor(value);
	} catch {
		throw new ValidationError("cursor must use <block_height>:<event_index>");
	}
}
