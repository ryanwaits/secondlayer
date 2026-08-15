import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// P6.11 — the archive publisher (`packages/indexer/src/archive/`) is an
// internal ops boundary: only shell/systemd (and the CLI's restore-snapshot
// bootstrap path) may reach into it. The runtime planes — api, worker,
// subgraphs, and shared's runtime module — must never import from it, or the
// publisher stops being independently deletable/deployable.

const REPO_ROOT = resolve(import.meta.dir, "../../../..");

const SCANNED_ROOTS = [
	"packages/api/src",
	"packages/worker/src",
	"packages/subgraphs/src",
	"packages/shared/src/runtime",
];

/** Matches any module specifier that reaches into the publisher directory,
 *  relative (`../../indexer/src/archive/x.ts`) or aliased
 *  (`@secondlayer/indexer/archive/...`). */
const ARCHIVE_SPECIFIER =
	/(?:indexer\/src\/archive|@secondlayer\/indexer\/(?:src\/)?archive)/;

/** Static + dynamic import and export-from specifiers. */
const IMPORT_SPECIFIER =
	/(?:from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

function listSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry === "dist") continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...listSourceFiles(full));
		} else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

describe("archive publisher import boundary", () => {
	test("no runtime plane (api/worker/subgraphs/shared-runtime) imports from packages/indexer/src/archive", () => {
		const violations: string[] = [];
		for (const root of SCANNED_ROOTS) {
			const dir = join(REPO_ROOT, root);
			for (const file of listSourceFiles(dir)) {
				const content = readFileSync(file, "utf8");
				for (const match of content.matchAll(IMPORT_SPECIFIER)) {
					const specifier = match[1];
					if (specifier && ARCHIVE_SPECIFIER.test(specifier)) {
						violations.push(`${file} -> ${specifier}`);
					}
				}
			}
		}
		expect(violations).toEqual([]);
	});

	test("scan roots exist (guard against silent renames making the boundary test vacuous)", () => {
		for (const root of SCANNED_ROOTS) {
			expect(statSync(join(REPO_ROOT, root)).isDirectory()).toBe(true);
		}
	});
});
