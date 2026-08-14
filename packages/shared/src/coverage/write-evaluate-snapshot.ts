import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASES } from "./evaluate.fixtures.ts";
import { evaluateCoverage } from "./evaluate.ts";

const reports: Record<string, ReturnType<typeof evaluateCoverage>> = {};
for (const [name, fixture] of Object.entries(CASES)) {
	reports[name] = evaluateCoverage(fixture);
}

const path = join(
	import.meta.dir,
	"../../test/__snapshots__/coverage-evaluate.json",
);
writeFileSync(path, `${JSON.stringify(reports, null, "\t")}\n`);
console.log(`wrote ${path}`);
