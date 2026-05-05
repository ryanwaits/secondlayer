export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export function stableJsonStringify(value: unknown): string {
	return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): JsonValue {
	if (value === null) return null;

	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}

	if (typeof value === "bigint") return value.toString();

	if (Array.isArray(value)) {
		return value.map((item) =>
			item === undefined ? null : sortJsonValue(item),
		);
	}

	if (typeof value === "object") {
		const source = value as Record<string, unknown>;
		const sorted: Record<string, JsonValue> = {};
		for (const key of Object.keys(source).sort()) {
			const item = source[key];
			if (item !== undefined) sorted[key] = sortJsonValue(item);
		}
		return sorted;
	}

	return null;
}
