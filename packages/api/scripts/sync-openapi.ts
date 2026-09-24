/**
 * Publishes the API's OpenAPI description to the docs site, which renders it
 * at /docs/api-reference instead of restating the surface by hand.
 *
 * Run from packages/api:  bun run openapi
 *
 * Lives here rather than in apps/web so the dependency points the right way:
 * the API owns its description and hands it over. The docs site never imports
 * @secondlayer/api, which would drag Postgres and Stripe into a static build.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openapiSpec } from "../src/routes/openapi.ts";

const OUT = join(
	import.meta.dir,
	"../../../apps/web/src/generated/openapi.json",
);

/** The sidebar's tree: tag → objects [anchor, title] and endpoints [anchor,
 *  method, title]. Small on purpose, since the sidebar ships on every docs page
 *  and the full spec should not. Anchors and object rules follow the reference
 *  page (apps/web .../api-reference/spec.ts); its tests fail on drift. */
const NAV_OUT = join(dirname(OUT), "openapi-nav.json");

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const kebab = (id: string) =>
	id
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
		.toLowerCase();

const spec = openapiSpec("oss");
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(spec, null, "\t")}\n`);

type Ref = { $ref?: string };
type NavSchema = Ref & {
	title?: string;
	type?: string;
	items?: Ref;
	properties?: Record<string, NavSchema>;
};
type NavOp = {
	operationId: string;
	summary?: string;
	tags?: string[];
	responses?: Record<
		string,
		{ content?: { "application/json"?: { schema?: NavSchema } } }
	>;
};
const schemas = spec.components.schemas as unknown as Record<
	string,
	NavSchema | undefined
>;
const refName = (ref: string) => ref.split("/").pop() ?? "";

/** The object an operation returns: a list envelope's row schema, or the named
 *  schema a single read returns. Same rule as the page's returnedObject(). */
function returnedObject(op: NavOp): string | null {
	const code = Object.keys(op.responses ?? {}).find((c) => c.startsWith("2"));
	const schema = code
		? op.responses?.[code]?.content?.["application/json"]?.schema
		: undefined;
	if (!schema) return null;
	if (schema.$ref) return refName(schema.$ref);
	for (const prop of Object.values(schema.properties ?? {})) {
		if (prop.type === "array" && prop.items?.$ref) {
			return refName(prop.items.$ref);
		}
	}
	return null;
}

const objectTitle = (name: string) =>
	`The ${
		schemas[name]?.title ??
		name
			.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
			.replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
	} object`;

type NavGroup = {
	objects: Array<{ anchor: string; title: string }>;
	endpoints: Array<{ anchor: string; method: string; title: string }>;
};
const emptyGroup = (): NavGroup => ({ objects: [], endpoints: [] });
const nav = new Map<string, NavGroup>(
	spec.tags.map((t) => [t.name, emptyGroup()]),
);
const seenObjects = new Set<string>();
const opsByAnchor = new Map<string, NavOp>();
// openapiSpec() stamps an operationId on every operation (withOperationIds in
// routes/openapi.ts), but its declared return type is the static spec, which
// predates that. Hence the cast through unknown.
for (const item of Object.values(spec.paths) as unknown as Record<
	string,
	NavOp | undefined
>[]) {
	for (const method of METHODS) {
		const op = item[method];
		if (!op) continue;
		const tag = op.tags?.[0] ?? "other";
		if (!nav.has(tag)) nav.set(tag, emptyGroup());
		nav.get(tag)?.endpoints.push({
			anchor: kebab(op.operationId),
			method: method.toUpperCase(),
			title: op.summary ?? op.operationId,
		});
		opsByAnchor.set(kebab(op.operationId), op);
	}
}
// An object sits under the first tag, in page order, whose endpoint returns it.
for (const group of nav.values()) {
	for (const endpoint of group.endpoints) {
		const op = opsByAnchor.get(endpoint.anchor);
		const object = op ? returnedObject(op) : null;
		if (!object || !schemas[object] || seenObjects.has(object)) continue;
		seenObjects.add(object);
		group.objects.push({
			anchor: `${kebab(object)}-object`,
			title: objectTitle(object),
		});
	}
}
const navJson = [...nav]
	.filter(([, group]) => group.endpoints.length > 0)
	.map(([tag, group]) => ({ tag, ...group }));
await writeFile(NAV_OUT, `${JSON.stringify(navJson, null, "\t")}\n`);

console.log(
	`✓ apps/web/src/generated/openapi.json — ${Object.keys(spec.paths).length} paths`,
);
console.log(
	`✓ apps/web/src/generated/openapi-nav.json — ${navJson.length} tags`,
);
