import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The SDK's public Index types live in three hand-maintained lists:
 *
 *   1. definitions in `index-api/client.ts`
 *   2. a curated re-export block in `index-api/index.ts`
 *   3. another re-export block in `index.ts` (the package root)
 *
 * Nothing in the type system enforces that they agree, and they have already
 * drifted once: the pox-5 surface landed in `client.ts` with neither barrel
 * updated, so `sl.index.pox5.events.list()` worked while
 * `import type { IndexPox5Event } from "@secondlayer/sdk"` did not.
 *
 * These tests read the three files off disk and assert they stay in sync.
 */

const CLIENT_PATH = join(import.meta.dir, "client.ts");
const INDEX_API_BARREL_PATH = join(import.meta.dir, "index.ts");
const ROOT_BARREL_PATH = join(import.meta.dir, "..", "index.ts");

/** Top-level `export type X` / `export interface X` declarations. */
function declaredTypes(source: string): string[] {
	const names: string[] = [];
	const pattern = /^export (?:type|interface) ([A-Za-z0-9_]+)/gm;
	let match = pattern.exec(source);
	while (match !== null) {
		names.push(match[1] as string);
		match = pattern.exec(source);
	}
	return names;
}

/**
 * Names re-exported from `export { … } from "…";` / `export type { … } from "…";`
 * blocks. Line-wise so the `export {` and `} from` lines never leak in.
 */
function reExportedNames(source: string): string[] {
	const names: string[] = [];
	let inBlock = false;
	for (const line of source.split("\n")) {
		if (/^export (?:type )?\{$/.test(line)) {
			inBlock = true;
			continue;
		}
		if (inBlock) {
			if (/^\} from ".+";$/.test(line)) {
				inBlock = false;
				continue;
			}
			const entry = /^\t(?:type )?([A-Za-z0-9_]+),?$/.exec(line);
			if (entry) names.push(entry[1] as string);
		}
	}
	return names;
}

/**
 * The consumer-facing naming conventions of the Index surface. Anything in
 * `client.ts` outside these shapes may legitimately be internal; the barrels
 * are a curated subset, not a mirror.
 */
function isPublicIndexName(name: string): boolean {
	return (
		name.startsWith("Index") ||
		name.endsWith("Envelope") ||
		name.endsWith("ListParams") ||
		name.endsWith("WalkParams") ||
		name.endsWith("Resource")
	);
}

const clientTypes = declaredTypes(readFileSync(CLIENT_PATH, "utf8"));
const indexApiBarrel = reExportedNames(
	readFileSync(INDEX_API_BARREL_PATH, "utf8"),
);
const rootBarrel = reExportedNames(readFileSync(ROOT_BARREL_PATH, "utf8"));

describe("public type barrels", () => {
	test("the extraction helpers actually found the three lists", () => {
		expect(clientTypes.length).toBeGreaterThan(50);
		expect(indexApiBarrel.length).toBeGreaterThan(50);
		expect(rootBarrel.length).toBeGreaterThan(50);
	});

	test("every type the index-api barrel exports is reachable from the package root", () => {
		const root = new Set(rootBarrel);
		const missing = indexApiBarrel.filter((name) => !root.has(name));
		expect(
			missing,
			`These types are exported by src/index-api/index.ts but not by src/index.ts, so they are unreachable via \`import type { … } from "@secondlayer/sdk"\`. Add them to the \`from "./index-api/index.ts"\` block in src/index.ts: ${missing.join(", ")}`,
		).toEqual([]);
	});

	test("every public Index type defined in client.ts is exported by the index-api barrel", () => {
		const barrel = new Set(indexApiBarrel);
		const missing = clientTypes
			.filter(isPublicIndexName)
			.filter((name) => !barrel.has(name));
		expect(
			missing,
			`These types are declared in src/index-api/client.ts and match the SDK's public naming conventions, but are not re-exported by src/index-api/index.ts. Add them to the \`from "./client.ts"\` block (or rename them if they are meant to be internal): ${missing.join(", ")}`,
		).toEqual([]);
	});
});
