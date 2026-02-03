import { sql } from "kysely";

/**
 * Safely encode a JS value as a JSONB literal for Kysely inserts/updates.
 * Kysely + postgres.js double-encodes JSON when using parameterized queries
 * with ::jsonb casts. This uses sql.raw to inline a properly escaped literal.
 */
export function jsonb(value: unknown) {
  const escaped = JSON.stringify(value).replace(/'/g, "''");
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
