/**
 * Keeps docs "new" marks current (see src/lib/docs-new.mjs).
 *
 * `stamp <page.mdx…>` marks each `##` the working copy adds over HEAD, marks
 * the title of a page HEAD lacks, and strips expired marks. The pre-commit
 * hook runs it on staged docs pages. Every run then rewrites
 * src/generated/docs-new.json, the page marks the sidebar's top-level rows
 * read (it cannot read MDX in the browser).
 *
 * Usage (from apps/web): bun run docs:new [stamp <files…>]
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Glob } from "bun";
import { pageNewDate, stampNewMarks } from "../src/lib/docs-new.mjs";
import { routeOf } from "../src/lib/remark-code-tips.mjs";

const DOCS = join(import.meta.dir, "..", "src", "app", "(www)", "docs");
const OUT = join(import.meta.dir, "..", "src", "generated", "docs-new.json");

/** The page as HEAD has it, or null when HEAD has no such file. */
function committed(path: string): string | null {
	const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	}).trim();
	try {
		return execFileSync(
			"git",
			["show", `HEAD:${relative(root, resolve(path))}`],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		);
	} catch {
		return null;
	}
}

/** `{ route: date }` for every docs page whose title carries a mark. */
export function pageMarks(): Record<string, string> {
	const out: Record<string, string> = {};
	for (const file of [...new Glob("**/page.mdx").scanSync(DOCS)].sort()) {
		const path = join(DOCS, file);
		const date = pageNewDate(readFileSync(path, "utf8"));
		const route = routeOf(path);
		if (date && route) out[route] = date;
	}
	return out;
}

if (import.meta.main) {
	const [command, ...files] = process.argv.slice(2);
	if (command === "stamp") {
		const today = new Date().toISOString().slice(0, 10);
		for (const file of files) {
			const after = readFileSync(file, "utf8");
			const stamped = stampNewMarks(committed(file), after, today);
			if (stamped !== after) {
				writeFileSync(file, stamped);
				console.log(`docs-new: stamped ${file}`);
			}
		}
	}
	writeFileSync(OUT, `${JSON.stringify(pageMarks(), null, "\t")}\n`);
}
