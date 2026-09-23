import { describe, expect, test } from "bun:test";
import { OPERATION_IDS, SCHEMAS_BY_FILE, openapiSpec } from "./openapi.ts";

type Schema = {
	$ref?: string;
	title?: string;
	type?: string | string[];
	description?: string;
	example?: unknown;
	properties?: Record<string, Schema>;
	items?: Schema;
};
type Param = {
	name?: string;
	in?: string;
	description?: string;
	$ref?: string;
};
type Media = { schema?: Schema };
type Operation = {
	operationId?: string;
	tags?: string[];
	summary?: string;
	description?: string;
	parameters?: Param[];
	requestBody?: { content?: Record<string, Media> };
	responses?: Record<
		string,
		{ description?: string; content?: Record<string, Media> }
	>;
};
type Spec = {
	paths: Record<string, Record<string, Operation>>;
	components: {
		parameters?: Record<string, Param>;
		schemas?: Record<string, Schema>;
	};
};

const METHODS = ["get", "post", "put", "patch", "delete"];
const MODES = ["oss", "platform"] as const;

function operations(spec: Spec): Array<[string, Operation]> {
	return Object.entries(spec.paths).flatMap(([path, item]) =>
		METHODS.filter((m) => item[m]).map(
			(m) =>
				[`${m.toUpperCase()} ${path}`, item[m] as Operation] as [
					string,
					Operation,
				],
		),
	);
}

const specs = MODES.map((mode) => openapiSpec(mode) as unknown as Spec);
const oss = specs[0] as Spec;

function component(spec: Spec, ref: string): Schema | undefined {
	return spec.components.schemas?.[ref.split("/").pop() ?? ""];
}

/**
 * A schema the reference can render as an object: named or inline, with a
 * real example and every top-level property described (a property that is
 * itself a `$ref` is described by the component it points at).
 */
function schemaViolations(spec: Spec, schema: Schema, where: string): string[] {
	const resolved = schema.$ref ? component(spec, schema.$ref) : schema;
	if (!resolved) return [`${where}: $ref ${schema.$ref} does not resolve`];
	const out: string[] = [];
	if (resolved.example === undefined && schema.example === undefined) {
		out.push(`${where}: no example`);
	}
	for (const [name, prop] of Object.entries(resolved.properties ?? {})) {
		if (!prop.$ref && !prop.description) {
			out.push(`${where}.${name}: no description`);
		}
	}
	return out;
}

/** A list envelope's row schema, if this success schema is one. */
function envelopeItems(schema: Schema): Schema | undefined {
	for (const prop of Object.values(schema.properties ?? {})) {
		if (prop.type === "array" && prop.items?.$ref) return prop.items;
	}
	return undefined;
}

/** Everything the API reference renders, checked for one operation (plan 041). */
function contractViolations(spec: Spec, op: Operation): string[] {
	const out: string[] = [];
	if (!op.summary) out.push("no summary");
	if (!op.description) out.push("no description");
	if (!op.tags?.length) out.push("no tag");

	for (const raw of op.parameters ?? []) {
		const p = raw.$ref
			? spec.components.parameters?.[raw.$ref.split("/").pop() ?? ""]
			: raw;
		if (!p?.description)
			out.push(`param ${p?.name ?? raw.$ref}: no description`);
	}

	const body = op.requestBody?.content?.["application/json"]?.schema;
	if (body) out.push(...schemaViolations(spec, body, "request body"));

	for (const [status, res] of Object.entries(op.responses ?? {})) {
		if (
			!res.description ||
			res.description === "Error" ||
			res.description === "OK"
		) {
			out.push(`${status}: says only "${res.description ?? ""}"`);
		}
	}

	const successCode = Object.keys(op.responses ?? {}).find((c) =>
		c.startsWith("2"),
	);
	const success = successCode ? op.responses?.[successCode] : undefined;
	const json = success?.content?.["application/json"];
	if (json) {
		const schema = json.schema;
		if (!schema || Object.keys(schema).length === 0) {
			out.push(`${successCode}: no schema`);
		} else {
			const items = envelopeItems(schema);
			const named = items?.$ref ?? schema.$ref;
			if (named && !component(spec, named)?.title) {
				out.push(
					`${successCode}: ${named} has no display title (SCHEMA_TITLES)`,
				);
			}
			out.push(
				...schemaViolations(
					spec,
					items ?? schema,
					`${successCode} ${items ? "row" : "body"}`,
				),
			);
		}
	}
	return out;
}

describe("operationIds (the reference's # anchors)", () => {
	for (const [i, mode] of MODES.entries()) {
		test(`every ${mode} operation has one, and they are unique`, () => {
			const ops = operations(specs[i] as Spec);
			expect(ops.filter(([, op]) => !op.operationId).map(([k]) => k)).toEqual(
				[],
			);
			const ids = ops.map(([, op]) => op.operationId);
			expect(new Set(ids).size).toBe(ids.length);
		});
	}

	test("no OPERATION_IDS key outlives its route", () => {
		const live = new Set(specs.flatMap((s) => operations(s).map(([k]) => k)));
		expect(Object.keys(OPERATION_IDS).filter((k) => !live.has(k))).toEqual([]);
	});
});

describe("component schemas", () => {
	test("no two tag files define the same schema name", () => {
		const seen = new Map<string, string>();
		const clashes: string[] = [];
		for (const [file, schemas] of Object.entries(SCHEMAS_BY_FILE)) {
			for (const name of Object.keys(schemas)) {
				const prior = seen.get(name);
				if (prior) clashes.push(`${name} in ${prior} and ${file}`);
				seen.set(name, file);
			}
		}
		expect(clashes).toEqual([]);
	});

	test("list envelopes carry the route's real row key", () => {
		const schema =
			oss.paths["/v1/index/blocks"]?.get?.responses?.["200"]?.content?.[
				"application/json"
			]?.schema;
		expect(Object.keys(schema?.properties ?? {})).toContain("blocks");
		expect(Object.keys(schema?.properties ?? {})).not.toContain("events");
	});
});

// Run one tag with: bun test src/routes/openapi.test.ts -t "/v1/index/"
describe("every operation meets the reference contract (plan 041)", () => {
	for (const [key, op] of operations(oss)) {
		test(key, () => {
			expect(contractViolations(oss, op)).toEqual([]);
		});
	}
});
