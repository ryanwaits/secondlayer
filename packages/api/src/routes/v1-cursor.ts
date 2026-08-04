import { ValidationError } from "@secondlayer/shared/errors";

/**
 * Cursor codec for `/v1` subgraph table reads.
 *
 * Two shapes, kept strictly separate:
 *
 *   - **Legacy** (`_sort` absent): a bare `_id` integer, e.g. `"42"`. This is
 *     the pre-existing format — untouched, so every client that predates
 *     `_sort` keeps working byte-for-byte. Parsed inline in the route with
 *     the original `/^\d+$/` check; nothing here changes that path.
 *   - **Sorted** (`_sort` present): a composite `(sort_value, _id)` keyset,
 *     base64url of a small JSON object. Opaque to clients.
 *
 * Sorted cursors embed the sort column + direction they were issued under so
 * a cursor from one `_sort` can't be silently replayed against another —
 * that would re-anchor the keyset scan mid-column and skip or duplicate rows.
 */

export type SortDir = "asc" | "desc";

/** Decoded payload of a sorted cursor: the row it left off at. */
export interface SortedCursorPosition {
	/** Sort column's value at the cursor row, kept as a string end-to-end —
	 *  NUMERIC values can exceed `Number.MAX_SAFE_INTEGER`, so this is never
	 *  parsed with `Number()`. `null` when the cursor sits in the NULL
	 *  partition of the sort column. */
	value: string | null;
	/** `_id` tiebreaker, as a string (BIGSERIAL can also exceed safe-integer
	 *  range at production scale). */
	id: string;
}

/** Raw shape of the decoded JSON — short keys to keep the encoded cursor small. */
interface SortedCursorPayload {
	c: string;
	o: SortDir;
	v: string | null;
	i: string;
}

function invalidCursor(raw: string): ValidationError {
	return new ValidationError(`invalid cursor: ${raw}`);
}

/** Builds the opaque cursor string for a `_sort`-paginated page. */
export function encodeSortedCursor(
	column: string,
	order: SortDir,
	value: string | null,
	id: string,
): string {
	const json = JSON.stringify({ c: column, o: order, v: value, i: id });
	return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decodes a cursor issued for a `_sort`-paginated page. Throws the same
 * `invalid cursor: <raw>` `ValidationError` the legacy bare-integer path
 * throws on malformed input, so callers get one consistent 400 shape.
 *
 * `expected` is the column+direction of the CURRENT request. A cursor
 * encoded under a different `_sort`/`_order` decodes fine structurally but
 * is rejected with a distinct message — replaying it would silently
 * re-anchor the keyset scan under a different ordering and skip or
 * duplicate rows.
 */
export function decodeSortedCursor(
	raw: string,
	expected: { column: string; order: SortDir },
): SortedCursorPosition {
	let parsed: unknown;
	try {
		const json = Buffer.from(raw, "base64url").toString("utf8");
		parsed = JSON.parse(json);
	} catch {
		throw invalidCursor(raw);
	}
	if (!isSortedCursorPayload(parsed)) {
		throw invalidCursor(raw);
	}
	if (parsed.c !== expected.column || parsed.o !== expected.order) {
		throw new ValidationError(
			`cursor was issued for _sort=${parsed.c}&_order=${parsed.o}, but this request is _sort=${expected.column}&_order=${expected.order} — resume with the cursor this endpoint returned, not one from a different sort`,
		);
	}
	return { value: parsed.v, id: parsed.i };
}

function isSortedCursorPayload(value: unknown): value is SortedCursorPayload {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.c === "string" &&
		(v.o === "asc" || v.o === "desc") &&
		(v.v === null || typeof v.v === "string") &&
		typeof v.i === "string"
	);
}
