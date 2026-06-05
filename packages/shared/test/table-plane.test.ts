import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TABLE_TO_DB } from "../src/db/table-plane.ts";

/**
 * Guards the canonical `TABLE_TO_DB` registry against drift with the cutover
 * script's hand-maintained `CONTROL_TABLES` bash array. The TS `satisfies`
 * already enforces exhaustiveness vs `keyof Database` at compile time; this
 * keeps the runtime artifacts (the cutover script) in sync.
 */

function parseControlTables(): string[] {
	const sh = readFileSync(
		join(import.meta.dir, "../../../docker/scripts/split-platform-db.sh"),
		"utf8",
	);
	const m = sh.match(/CONTROL_TABLES=\(([\s\S]*?)\)/);
	if (!m)
		throw new Error("CONTROL_TABLES array not found in split-platform-db.sh");
	return m[1]
		.split("\n")
		.map((l) => l.replace(/#.*$/, "").trim())
		.filter((l) => l.length > 0);
}

describe("TABLE_TO_DB registry", () => {
	test("every entry is a valid plane", () => {
		for (const v of Object.values(TABLE_TO_DB)) {
			expect(["source", "target", "both"]).toContain(v);
		}
	});

	test("'target' set matches the cutover script's CONTROL_TABLES", () => {
		const registryTarget = Object.entries(TABLE_TO_DB)
			.filter(([, plane]) => plane === "target")
			.map(([table]) => table)
			.sort();
		const control = parseControlTables().sort();
		expect(control).toEqual(registryTarget);
	});

	test("no table is mapped to more than one plane", () => {
		const keys = Object.keys(TABLE_TO_DB);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
