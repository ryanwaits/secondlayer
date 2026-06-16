import {
	type FieldValues,
	PUBLIC_API_BASE,
	type PlaygroundConfig,
} from "./types";

/** Seed field state from each field's declared default. */
export function defaultValues(config: PlaygroundConfig): FieldValues {
	const values: FieldValues = {};
	for (const field of config.request.fields) values[field.name] = field.default;
	return values;
}

/** Fill `{name}` path slots and collect non-empty query params in one pass. */
function applyFields(config: PlaygroundConfig, values: FieldValues) {
	let path = config.request.path;
	const query = new URLSearchParams();
	for (const field of config.request.fields) {
		const value = String(values[field.name] ?? "").trim();
		if (field.into === "path") {
			path = path.replace(`{${field.name}}`, encodeURIComponent(value));
		} else if (value !== "") {
			query.set(field.name, value);
		}
	}
	return { path, query };
}

/** Path + query only — what shows in the request line. */
export function buildPath(
	config: PlaygroundConfig,
	values: FieldValues,
): string {
	const { path, query } = applyFields(config, values);
	const qs = query.toString();
	return `${path}${qs ? `?${qs}` : ""}`;
}

/** Absolute URL the playground actually fetches. */
export function buildUrl(
	config: PlaygroundConfig,
	values: FieldValues,
): string {
	const base = config.request.base ?? PUBLIC_API_BASE;
	return `${base}${buildPath(config, values)}`;
}

/** Copy-pasteable curl for the current request. */
export function buildCurl(
	config: PlaygroundConfig,
	values: FieldValues,
): string {
	return `curl '${buildUrl(config, values)}'`;
}
