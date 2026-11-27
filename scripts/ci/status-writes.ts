/**
 * Raw status-write guard. State machines write status through `casTransition`
 * (packages/shared/src/db/transition.ts). This lists every `status` key anywhere in a
 * `.set({…})` or `.doUpdateSet({…})` literal and every `SET status` (case-insensitive),
 * including in files that already use `casTransition`, and fails only when a file has
 * more raw writes than `status-writes.baseline.json` records.
 *
 *   bun scripts/ci/status-writes.ts           check (CI)
 *   bun scripts/ci/status-writes.ts --write   rewrite the baseline
 */
import { Glob } from "bun";

const ROOT = new URL("../../", import.meta.url).pathname;
const BASELINE = `${ROOT}scripts/ci/status-writes.baseline.json`;
const KYSELY_RAW_WRITE =
	/\.(?:set|doUpdateSet)\(\s*\{(?:[^{}]|\{[^{}]*\})*?\bstatus\s*:/g;
const SQL_RAW_WRITE = /\bSET\s+status\b/gi;
const SKIP = /(^|\/)(node_modules|dist|migrations)\/|\.test\.tsx?$/;

export function countRawStatusWrites(source: string): number {
	return (
		(source.match(KYSELY_RAW_WRITE)?.length ?? 0) +
		(source.match(SQL_RAW_WRITE)?.length ?? 0)
	);
}

async function scan(): Promise<Record<string, number>> {
	const counts: Record<string, number> = {};
	for (const pattern of ["packages/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}"]) {
		for await (const path of new Glob(pattern).scan({ cwd: ROOT })) {
			if (SKIP.test(path)) continue;
			const source = await Bun.file(ROOT + path).text();
			const hits = countRawStatusWrites(source);
			if (hits > 0) counts[path] = hits;
		}
	}
	return Object.fromEntries(
		Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)),
	);
}

if (import.meta.main) {
	const current = await scan();

	if (process.argv.includes("--write")) {
		await Bun.write(BASELINE, `${JSON.stringify(current, null, "\t")}\n`);
		console.log(
			`status-writes: baseline written (${Object.keys(current).length} files)`,
		);
		process.exit(0);
	}

	const baseline: Record<string, number> = await Bun.file(BASELINE).json();
	const added = Object.entries(current).filter(
		([path, count]) => count > (baseline[path] ?? 0),
	);

	if (added.length > 0) {
		console.error("status-writes: new raw status writes (use casTransition):");
		for (const [path, count] of added) {
			console.error(`  ${path}: ${count} (baseline ${baseline[path] ?? 0})`);
		}
		process.exit(1);
	}
	console.log(
		`status-writes: ok (${Object.values(current).reduce((a, b) => a + b, 0)} raw writes in ${Object.keys(current).length} files, none new)`,
	);
}
