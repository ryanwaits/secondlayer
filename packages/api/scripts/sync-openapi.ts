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

/** The sidebar's endpoint tree: tag → [anchor, method, title]. Small on
 *  purpose, since the sidebar ships on every docs page and the full spec
 *  should not. Anchors follow the reference page's rule (kebab operationId). */
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

type NavOp = { operationId: string; summary?: string; tags?: string[] };
const nav = new Map<
	string,
	Array<{ anchor: string; method: string; title: string }>
>(spec.tags.map((t) => [t.name, []]));
for (const item of Object.values(spec.paths) as Record<string, NavOp>[]) {
	for (const method of METHODS) {
		const op = item[method];
		if (!op) continue;
		const tag = op.tags?.[0] ?? "other";
		if (!nav.has(tag)) nav.set(tag, []);
		nav.get(tag)?.push({
			anchor: kebab(op.operationId),
			method: method.toUpperCase(),
			title: op.summary ?? op.operationId,
		});
	}
}
const navJson = [...nav]
	.filter(([, endpoints]) => endpoints.length > 0)
	.map(([tag, endpoints]) => ({ tag, endpoints }));
await writeFile(NAV_OUT, `${JSON.stringify(navJson, null, "\t")}\n`);

console.log(
	`✓ apps/web/src/generated/openapi.json — ${Object.keys(spec.paths).length} paths`,
);
console.log(
	`✓ apps/web/src/generated/openapi-nav.json — ${navJson.length} tags`,
);
