// bun check.ts: run the same validateSpec the page runs on load, and make
// sure every catalog component can describe itself in the Copy for agent
// prompt. Prints "✓ spec ok" and exits 0, or lists each error and exits 1.
import { join } from "node:path";
import { CATALOG, type Catalog, validateSpec } from "./kit.js";

const dir = import.meta.dir;
const catalog = (await Bun.file(join(dir, "catalog.json")).json()) as Catalog;

/** Catalog components kit.js can't put in the page prompt. */
export function missingPrompts(names: string[]): string[] {
	return names.filter((name) => typeof CATALOG[name]?.prompt !== "function");
}

if (import.meta.main) {
	const problems = missingPrompts(Object.keys(catalog.components)).map(
		(name) => `✗ kit.js: ${name} has no prompt()`,
	);
	let spec: unknown;
	try {
		spec = await Bun.file(join(dir, "spec.json")).json();
	} catch (err) {
		problems.push(`✗ spec.json is not valid JSON: ${(err as Error).message}`);
	}
	if (spec !== undefined) {
		for (const e of validateSpec(spec, catalog)) {
			const where = [e.id, e.prop].filter(Boolean).join(".") || "spec";
			problems.push(`✗ ${where}: ${e.message}`);
		}
	}
	if (problems.length === 0) {
		console.log("✓ spec ok");
	} else {
		for (const line of problems) console.error(line);
		process.exit(1);
	}
}
