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

const spec = openapiSpec("oss");
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(spec, null, "\t")}\n`);

console.log(
	`✓ apps/web/src/generated/openapi.json — ${Object.keys(spec.paths).length} paths`,
);
