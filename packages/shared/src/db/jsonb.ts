import { type RawBuilder, sql } from "kysely";

/**
 * Safely encode a JS value as a JSONB literal for Kysely inserts/updates.
 * Kysely + postgres.js double-encodes JSON when using parameterized queries
 * with ::jsonb casts. This uses sql.raw to inline a properly escaped literal.
 *
 * Generic parameter lets callers set the RawBuilder's output type so they
 * don't need to cast at the insert site. Default is `unknown` — widen at
 * the call site when the column type is narrower, e.g. `jsonb<MyShape>(...)`.
 */
export function jsonb<T = unknown>(value: T): RawBuilder<T> {
	const escaped = JSON.stringify(value, (_k, v) =>
		typeof v === "bigint" ? v.toString() : v,
	).replace(/'/g, "''");
	return sql`${sql.raw(`'${escaped}'::jsonb`)}`;
}

/**
 * Safely parse a JSONB value from the database.
 * Handles double-encoded strings where postgres.js returns a JSON string
 * instead of a parsed object.
 */
export function parseJsonb<T = unknown>(value: unknown): T {
	if (typeof value === "string") {
		try {
			return JSON.parse(value) as T;
		} catch {
			return value as T;
		}
	}
	return (value ?? {}) as T;
}
