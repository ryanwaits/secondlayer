import raw from "@/generated/openapi.json";

/**
 * The API reference's view of the OpenAPI description. Everything the page,
 * the per-endpoint `.md` routes, and "Copy as Markdown" show is derived here
 * from `src/generated/openapi.json` (written by `bun run openapi` in
 * packages/api), so none of them can drift from what the API ships.
 */

export type Schema = {
	$ref?: string;
	title?: string;
	type?: string | string[];
	format?: string;
	description?: string;
	enum?: readonly (string | number | boolean | null)[];
	example?: unknown;
	minimum?: number;
	maximum?: number;
	required?: string[];
	properties?: Record<string, Schema>;
	items?: Schema;
};

export type Param = {
	name: string;
	in: "query" | "path" | "header";
	required?: boolean;
	description?: string;
	schema?: Schema;
	$ref?: string;
};

type Media = { schema?: Schema };

export type Operation = {
	operationId: string;
	tags?: string[];
	summary?: string;
	description?: string;
	security?: Array<Record<string, unknown>>;
	parameters?: Param[];
	requestBody?: { content?: Record<string, Media> };
	responses?: Record<
		string,
		{ description?: string; content?: Record<string, Media> }
	>;
	"x-codeSamples"?: Array<{ lang: string; label?: string; source: string }>;
};

type Spec = {
	info: { title: string; description?: string };
	tags?: Array<{ name: string; description?: string }>;
	components: {
		schemas?: Record<string, Schema>;
		parameters?: Record<string, Param>;
	};
	paths: Record<string, Record<string, Operation>>;
};

const SPEC = raw as unknown as Spec;

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export const HOSTED_BASE = "https://api.secondlayer.tools";
export const LOCAL_BASE = "http://127.0.0.1:3800";

/** Tags that exist only on a self-hosted instance: the `/api` write plane and
 *  the instance catalog. Their examples always use the local base URL. */
const SELF_HOST_TAGS = new Set(["deployments", "webhooks", "node", "instance"]);

/** Query parameters that shape the window rather than filter rows. */
const PAGING_PARAMS = new Set([
	"limit",
	"cursor",
	"from_cursor",
	"from_height",
	"to_height",
	"confirmed",
	"fields",
	"_limit",
	"_fields",
	"_sort",
	"_order",
]);

/** `listPox5Events` → `list-pox5-events`. The `#` anchor people share. */
export function kebab(id: string): string {
	return id
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
		.toLowerCase();
}

export type Endpoint = {
	anchor: string;
	method: string;
	path: string;
	tag: string;
	op: Operation;
	selfHostOnly: boolean;
};

export type TagGroup = {
	name: string;
	description?: string;
	endpoints: Endpoint[];
};

function refName(ref: string): string {
	return ref.split("/").pop() ?? "";
}

export function schemaByName(name: string): Schema | undefined {
	return SPEC.components.schemas?.[name];
}

function resolveSchema(schema: Schema | undefined): Schema | undefined {
	if (!schema?.$ref) return schema;
	return schemaByName(refName(schema.$ref));
}

function resolveParam(param: Param): Param {
	if (!param.$ref) return param;
	return SPEC.components.parameters?.[refName(param.$ref)] ?? param;
}

/** Every operation, grouped by tag in the spec's tag order. */
export function tagGroups(): TagGroup[] {
	const order = (SPEC.tags ?? []).map((t) => t.name);
	const groups = new Map<string, TagGroup>();
	for (const name of order) {
		groups.set(name, {
			name,
			description: SPEC.tags?.find((t) => t.name === name)?.description,
			endpoints: [],
		});
	}
	for (const [path, item] of Object.entries(SPEC.paths)) {
		for (const method of METHODS) {
			const op = item[method];
			if (!op) continue;
			const tag = op.tags?.[0] ?? "other";
			if (!groups.has(tag)) groups.set(tag, { name: tag, endpoints: [] });
			groups.get(tag)?.endpoints.push({
				anchor: kebab(op.operationId),
				method: method.toUpperCase(),
				path,
				tag,
				op,
				selfHostOnly: SELF_HOST_TAGS.has(tag),
			});
		}
	}
	return [...groups.values()].filter((g) => g.endpoints.length > 0);
}

export function allEndpoints(): Endpoint[] {
	return tagGroups().flatMap((g) => g.endpoints);
}

export function findEndpoint(anchor: string): Endpoint | undefined {
	return allEndpoints().find((e) => e.anchor === anchor);
}

export type ParamGroup = { title: string; params: Param[] };

/** Path parameters, then filters, then the paging/window controls. */
export function paramGroups(op: Operation): ParamGroup[] {
	const params = (op.parameters ?? []).map(resolveParam);
	const path = params.filter((p) => p.in === "path");
	const query = params.filter((p) => p.in === "query");
	const filters = query.filter((p) => !PAGING_PARAMS.has(p.name));
	const paging = query.filter((p) => PAGING_PARAMS.has(p.name));
	return [
		{ title: "Path parameters", params: path },
		{ title: paging.length ? "Filters" : "Query parameters", params: filters },
		{ title: "Range and paging", params: paging },
	].filter((g) => g.params.length > 0);
}

/** An enum's printable values. `null` is left out: the type label already
 *  says "nullable", and a bare null would print as an empty chip. */
export function enumValues(schema: Schema | undefined): string[] {
	return (schema?.enum ?? []).filter((v) => v !== null).map(String);
}

/** One schema's type as the reference prints it: `integer · 1 to 1000`. */
export function typeLabel(schema: Schema | undefined): string {
	if (!schema) return "string";
	if (schema.$ref) return refName(schema.$ref);
	const types = Array.isArray(schema.type) ? schema.type : [schema.type];
	const nullable = types.includes("null") || !!schema.enum?.includes(null);
	const base = types.filter((t) => t && t !== "null")[0] ?? "object";
	const parts = [schema.enum ? "enum" : base];
	if (schema.type === "array" && schema.items)
		parts[0] = `array of ${typeLabel(schema.items)}`;
	if (schema.format) parts.push(schema.format);
	if (schema.minimum !== undefined && schema.maximum !== undefined) {
		parts.push(`${schema.minimum} to ${schema.maximum}`);
	}
	if (nullable) parts.push("nullable");
	return parts.join(" · ");
}

export type BodyField = {
	name: string;
	required: boolean;
	schema: Schema;
};

/** A JSON request body's top-level fields, `$ref` resolved. */
export function bodyFields(op: Operation): BodyField[] {
	const schema = resolveSchema(
		op.requestBody?.content?.["application/json"]?.schema,
	);
	const required = new Set(schema?.required ?? []);
	return Object.entries(schema?.properties ?? {}).map(([name, s]) => ({
		name,
		required: required.has(name),
		schema: s,
	}));
}

function successResponse(op: Operation) {
	const code = Object.keys(op.responses ?? {}).find((c) => c.startsWith("2"));
	return code ? { code, res: op.responses?.[code] } : undefined;
}

export function successContentType(op: Operation): string | undefined {
	return Object.keys(successResponse(op)?.res?.content ?? {})[0];
}

/**
 * The object an operation returns: the row schema of a list envelope, or the
 * named schema a single read returns. Null when the body is inline or not JSON.
 */
export function returnedObject(
	op: Operation,
): { name: string; list: boolean; key?: string } | null {
	const schema =
		successResponse(op)?.res?.content?.["application/json"]?.schema;
	if (!schema) return null;
	if (schema.$ref) return { name: refName(schema.$ref), list: false };
	for (const [key, prop] of Object.entries(schema.properties ?? {})) {
		if (prop.type === "array" && prop.items?.$ref) {
			return { name: refName(prop.items.$ref), list: true, key };
		}
	}
	return null;
}

export function objectAnchor(name: string): string {
	return `${kebab(name)}-object`;
}

export type ObjectEntry = {
	name: string;
	anchor: string;
	schema: Schema;
	returnedBy: Endpoint[];
};

/** Every object some operation returns, in the order the endpoints use them. */
export function objectsByTag(): Map<string, ObjectEntry[]> {
	const out = new Map<string, ObjectEntry[]>();
	const seen = new Map<string, ObjectEntry>();
	for (const endpoint of allEndpoints()) {
		const returned = returnedObject(endpoint.op);
		if (!returned) continue;
		const existing = seen.get(returned.name);
		if (existing) {
			existing.returnedBy.push(endpoint);
			continue;
		}
		const schema = schemaByName(returned.name);
		if (!schema) continue;
		const entry = {
			name: returned.name,
			anchor: objectAnchor(returned.name),
			schema,
			returnedBy: [endpoint],
		};
		seen.set(returned.name, entry);
		out.set(endpoint.tag, [...(out.get(endpoint.tag) ?? []), entry]);
	}
	return out;
}

/** An object's display name: its schema `title` (`PoX-5 event`), else its
 *  schema name split into words. */
export function objectName(name: string): string {
	const title = schemaByName(name)?.title;
	if (title) return title;
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
}

export function objectTitle(name: string): string {
	return `The ${objectName(name)} object`;
}

function exampleOf(schema: Schema | undefined): unknown {
	if (!schema) return undefined;
	if (schema.example !== undefined) return schema.example;
	const resolved = resolveSchema(schema);
	if (resolved && resolved !== schema) return exampleOf(resolved);
	if (schema.type === "array") {
		const item = exampleOf(schema.items);
		return item === undefined ? [] : [item];
	}
	if (schema.properties) {
		const out: Record<string, unknown> = {};
		for (const [name, prop] of Object.entries(schema.properties)) {
			const value = exampleOf(prop);
			if (value !== undefined) out[name] = value;
		}
		return out;
	}
	return undefined;
}

/** The success body, assembled from the examples its schema carries. */
export function responseExample(op: Operation): unknown {
	const res = successResponse(op)?.res;
	return exampleOf(res?.content?.["application/json"]?.schema);
}

export function requestExample(op: Operation): unknown {
	return exampleOf(op.requestBody?.content?.["application/json"]?.schema);
}

function paramExample(param: Param): string | undefined {
	const value = param.schema?.example;
	return value === undefined ? undefined : String(value);
}

/** Does this operation need a credential on the chosen base URL? */
function needsToken(endpoint: Endpoint, base: "hosted" | "local"): boolean {
	if (base === "hosted") return true;
	const security = endpoint.op.security ?? [];
	return !security.some((s) => Object.keys(s).length === 0);
}

/**
 * The cURL for one endpoint. Path parameters use their example (or stay as a
 * `{placeholder}`); filter parameters appear only when the spec gives an example.
 */
export function curlFor(endpoint: Endpoint, base: "hosted" | "local"): string {
	const effective = endpoint.selfHostOnly ? "local" : base;
	const origin = effective === "hosted" ? HOSTED_BASE : LOCAL_BASE;
	const params = (endpoint.op.parameters ?? []).map(resolveParam);
	let path = endpoint.path;
	for (const p of params.filter((p) => p.in === "path")) {
		path = path.replace(`{${p.name}}`, paramExample(p) ?? `{${p.name}}`);
	}
	// Filters with an example make the request concrete; paging params stay out,
	// since a first request never carries a cursor.
	const query = params
		.filter((p) => p.in === "query" && !PAGING_PARAMS.has(p.name))
		.flatMap((p) => {
			const value = paramExample(p);
			return value === undefined ? [] : [`${p.name}=${value}`];
		});
	const isGet = endpoint.method === "GET";
	const lines = [
		`curl ${isGet ? (query.length ? "-G " : "") : `-X ${endpoint.method} `}${origin}${path}`,
	];
	if (needsToken(endpoint, effective)) {
		const token =
			effective === "hosted" ? "$SECONDLAYER_API_KEY" : "$INSTANCE_TOKEN";
		lines.push(`-H "Authorization: Bearer ${token}"`);
	}
	for (const q of query) lines.push(`-d ${q}`);
	const body = requestExample(endpoint.op);
	if (!isGet && body !== undefined) {
		lines.push(`--json '${JSON.stringify(body, null, 2)}'`);
	}
	return lines.join(" \\\n  ");
}

export function sdkSample(op: Operation): string | undefined {
	return op["x-codeSamples"]?.find((s) => s.lang === "TypeScript")?.source;
}

// ── Markdown (Copy as Markdown, /docs/api-reference/<anchor>.md, llms-full) ──

function mdValues(schema: Schema | undefined): string {
	const values = enumValues(schema);
	return values.length
		? ` Values: ${values.map((v) => `\`${v}\``).join(", ")}.`
		: "";
}

function mdParams(title: string, params: Param[]): string {
	const rows = params.map(
		(p) =>
			`| \`${p.name}\` | ${typeLabel(p.schema)}${p.required ? ", required" : ""} | ${(p.description ?? "").replace(/\n/g, " ")}${mdValues(p.schema)} |`,
	);
	return `### ${title}\n\n| Name | Type | Description |\n| --- | --- | --- |\n${rows.join("\n")}`;
}

export function endpointMarkdown(endpoint: Endpoint): string {
	const { op } = endpoint;
	const parts = [
		`## ${op.summary ?? op.operationId}`,
		`\`${endpoint.method} ${endpoint.path}\`${endpoint.selfHostOnly ? " (self-hosted instances only)" : ""}`,
		op.description ?? "",
	];
	for (const group of paramGroups(op)) {
		parts.push(mdParams(group.title, group.params));
	}
	const fields = bodyFields(op);
	if (fields.length) {
		parts.push(
			`### Body\n\n| Field | Type | Description |\n| --- | --- | --- |\n${fields
				.map(
					(f) =>
						`| \`${f.name}\` | ${typeLabel(f.schema)}${f.required ? ", required" : ""} | ${f.schema.description ?? ""} |`,
				)
				.join("\n")}`,
		);
	}
	const returned = returnedObject(op);
	if (returned) {
		parts.push(
			`### Returns\n\n${returned.list ? `A cursor envelope; \`${returned.key}\` holds` : "One"} \`${returned.name}\` ${returned.list ? "objects" : "object"}.`,
		);
	}
	const statuses = Object.entries(op.responses ?? {}).map(
		([code, res]) => `- \`${code}\` ${res.description ?? ""}`,
	);
	parts.push(`### Responses\n\n${statuses.join("\n")}`);
	parts.push(
		`### Example\n\n\`\`\`bash\n${curlFor(endpoint, "hosted")}\n\`\`\``,
	);
	const example = responseExample(op);
	if (example !== undefined) {
		parts.push(`\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\``);
	}
	return parts.filter(Boolean).join("\n\n");
}

export function objectMarkdown(entry: ObjectEntry): string {
	const rows = Object.entries(entry.schema.properties ?? {}).map(
		([name, s]) =>
			`| \`${name}\` | ${typeLabel(s)} | ${s.description ?? ""}${mdValues(s)} |`,
	);
	return [
		`## ${objectTitle(entry.name)}`,
		entry.schema.description ?? "",
		`| Field | Type | Description |\n| --- | --- | --- |\n${rows.join("\n")}`,
		entry.schema.example === undefined
			? ""
			: `\`\`\`json\n${JSON.stringify(entry.schema.example, null, 2)}\n\`\`\``,
	]
		.filter(Boolean)
		.join("\n\n");
}

/** The whole reference as markdown, tag by tag. */
export function referenceMarkdown(): string {
	const objects = objectsByTag();
	return tagGroups()
		.map((group) =>
			[
				`# ${group.name}`,
				group.description ?? "",
				...(objects.get(group.name) ?? []).map(objectMarkdown),
				...group.endpoints.map(endpointMarkdown),
			]
				.filter(Boolean)
				.join("\n\n"),
		)
		.join("\n\n---\n\n");
}
