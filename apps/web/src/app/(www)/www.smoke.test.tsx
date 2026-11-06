import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DOCS_STRIP } from "@/lib/nav";
import { DOCS_NAV, docsNavPages } from "./docs/nav";

describe("docs site strip", () => {
	test("session chrome is not hardcoded into the leave-docs links", () => {
		expect(DOCS_STRIP.map((l) => l.label)).toEqual([
			"Home",
			"Archive",
			"Pricing",
			"Docs",
			"Blog",
		]);
		expect(DOCS_STRIP.map((l) => l.href)).not.toContain("/signin");
	});
});

describe("docs sidebar invariant", () => {
	const docsRoot = join(import.meta.dir, "docs");
	const expectedGroups = [
		"Start",
		"Products",
		"Tools",
		"Guides",
		"API reference",
		"SDK reference",
		"Reference",
	] as const;

	test("every docs page is reachable from the sidebar and vice versa", () => {
		expect(DOCS_NAV.map((g) => g.label)).toEqual([...expectedGroups]);

		const navHrefs = new Set(docsNavPages().map((p) => p.href));

		for (const href of navHrefs) {
			const rel =
				href === "/docs"
					? "page.mdx"
					: `${href.slice("/docs/".length)}/page.mdx`;
			expect(existsSync(join(docsRoot, rel))).toBe(true);
		}

		const glob = new Bun.Glob("**/page.mdx");
		for (const path of glob.scanSync({ cwd: docsRoot })) {
			const href =
				path === "page.mdx"
					? "/docs"
					: `/docs/${path.replace(/\/page\.mdx$/, "")}`;
			expect(navHrefs.has(href)).toBe(true);
		}
	});
});
