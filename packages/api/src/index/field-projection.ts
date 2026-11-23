import { ValidationError } from "@secondlayer/shared/errors";

/**
 * Columns that survive any projection, everywhere.
 *
 * `cursor` is how the caller paginates and `block_height` is what the reorg
 * span is computed from — dropping either would break the envelope rather than
 * shrink the row, so they are not the caller's to omit.
 */
export const ALWAYS_PROJECTED = ["cursor", "block_height"] as const;

/**
 * Parse and validate a `fields` parameter against the columns a resource can
 * serve.
 *
 * Unknown names are REFUSED rather than ignored: silently dropping a
 * misspelled field hands back a row missing exactly the column the caller
 * believes they asked for, which surfaces as a null far from the cause.
 */
export function parseFields(
	raw: string | null,
	allowed: Iterable<string>,
	extra: Iterable<string> = [],
): readonly string[] | undefined {
	if (raw === null) return undefined;
	const requested = raw
		.split(",")
		.map((field) => field.trim())
		.filter(Boolean);
	if (requested.length === 0) {
		throw new ValidationError("fields must name at least one column", 400);
	}
	const permitted = new Set<string>([
		...ALWAYS_PROJECTED,
		...allowed,
		...extra,
	]);
	for (const field of requested) {
		if (!permitted.has(field)) {
			throw new ValidationError(
				`unknown field: ${field} (available: ${[...permitted].sort().join(", ")})`,
				400,
			);
		}
	}
	return requested;
}

/**
 * Drop everything the caller didn't ask for.
 *
 * Applied to the normalized row rather than the SELECT list because the reader
 * needs columns the caller may have omitted — the keyset cursor and the reorg
 * span are computed from `block_height`/`event_index` regardless. The row the
 * caller receives is still genuinely missing the column, which is what makes
 * the narrowed SDK type honest.
 */
export function projectRow<T extends Record<string, unknown>>(
	row: T,
	fields: ReadonlySet<string> | undefined,
	alwaysKeep: Iterable<string> = ALWAYS_PROJECTED,
): T {
	if (!fields) return row;
	const keep = new Set<string>([...alwaysKeep, ...fields]);
	for (const key of Object.keys(row)) {
		if (!keep.has(key)) delete row[key];
	}
	return row;
}
