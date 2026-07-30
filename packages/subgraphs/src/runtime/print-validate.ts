import type { ColumnType, PrintField } from "../types.ts";

/**
 * Runtime validation of a decoded print payload against a source's declared
 * `prints` schema.
 *
 * Declaring `prints` is the opt-in that makes strictness safe: the developer
 * has stated the shape, so a mismatch is a real defect (a contract upgrade,
 * or a hand-written declaration that never matched — the bns-names class of
 * bug, where a handler read flat `data.name` while BNS-V2 emitted a nested
 * tuple, and every event silently decoded to null for a whole deploy).
 *
 * Failure mode is SKIP + LOG, never throw: throwing would fail the block, and
 * a poisoned block that can never advance is incompatible with the
 * checkpoint model. One bad event is dropped and counted; the rest of the
 * block commits.
 */

const COLUMN_TYPES = new Set<string>([
	"text",
	"uint",
	"int",
	"principal",
	"boolean",
	"timestamp",
	"jsonb",
]);

function isColumnType(field: PrintField): field is ColumnType {
	return typeof field === "string" && COLUMN_TYPES.has(field);
}

/** Does a decoded value match one declared field? */
function matchesField(field: PrintField, value: unknown): boolean {
	if (isColumnType(field)) {
		switch (field) {
			case "uint":
			case "int":
				return typeof value === "bigint" || typeof value === "number";
			case "boolean":
				return typeof value === "boolean";
			case "text":
			case "principal":
			case "timestamp":
				// Buffers decode to strings; principals too. Accept any scalar the
				// decoder can render, but reject objects/arrays.
				return (
					typeof value === "string" ||
					typeof value === "number" ||
					typeof value === "bigint"
				);
			case "jsonb":
				// Deliberately permissive: `jsonb` is the "shape unknown" escape.
				return value !== undefined;
		}
	}
	if (typeof field !== "object" || field === null) return false;
	if ("optional" in field) {
		return (
			value === undefined || value === null || matchesField(field.type, value)
		);
	}
	if ("tuple" in field) {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return false;
		}
		return matchesTopic(field.tuple, value as Record<string, unknown>).ok;
	}
	if ("list" in field) {
		return (
			Array.isArray(value) &&
			value.every((item) => matchesField(field.list, item))
		);
	}
	return false;
}

export type PrintValidationResult =
	| { ok: true }
	| { ok: false; reason: string };

/** Validate a decoded payload object against one topic's declared fields. */
export function matchesTopic(
	declared: Record<string, PrintField>,
	data: Record<string, unknown>,
): PrintValidationResult {
	for (const [name, field] of Object.entries(declared)) {
		const present = name in data;
		const optional =
			typeof field === "object" && field !== null && "optional" in field;
		if (!present) {
			if (optional) continue;
			return { ok: false, reason: `missing declared field "${name}"` };
		}
		if (!matchesField(field, data[name])) {
			return {
				ok: false,
				reason: `field "${name}" does not match its declared type (got ${describe(data[name])})`,
			};
		}
	}
	return { ok: true };
}

function describe(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

/**
 * Validate one decoded print event against a source's `prints` declaration.
 * Returns `{ ok: true }` when no declaration covers this topic (undeclared
 * topics are not the developer's stated contract, so they pass through).
 */
export function validatePrintPayload(
	prints: Record<string, Record<string, PrintField>> | undefined,
	topic: string,
	data: Record<string, unknown>,
): PrintValidationResult {
	if (!prints) return { ok: true };
	const declared = prints[topic];
	if (!declared) return { ok: true };
	return matchesTopic(declared, data);
}
