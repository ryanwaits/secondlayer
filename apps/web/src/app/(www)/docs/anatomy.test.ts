import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Product pages that follow the docs page anatomy (plans add pages here). */
const ANATOMY_PAGES: string[] = [];

/** Position of the first match at or after `from`, or -1. */
const at = (source: string, pattern: RegExp, from = 0) => {
	const m = pattern.exec(source.slice(from));
	return m ? from + m.index : -1;
};

describe("docs page anatomy", () => {
	for (const page of ANATOMY_PAGES) {
		test(`${page} follows the product page anatomy`, () => {
			const mdx = readFileSync(join(import.meta.dir, page, "page.mdx"), "utf8");
			const yields = at(mdx, /<Yields page=/);
			expect(yields, "a <Yields page=> tag").toBeGreaterThanOrEqual(0);

			const hero = at(mdx, /^## /m, yields);
			expect(hero, "a hero ## after Yields").toBeGreaterThan(yields);

			const nextH2 = at(mdx, /^## /m, hero + 1);
			const fence = at(mdx, /^```/m, hero);
			expect(fence, "a fenced block in the hero section").toBeGreaterThan(hero);
			expect(fence).toBeLessThan(nextH2);

			const check = at(mdx, /^## Check it/m, hero);
			expect(check, "a ## Check it heading").toBeGreaterThan(hero);
			const seam = at(mdx, /<Seam page=/, check);
			expect(seam, "a <Seam page=> tag after Check it").toBeGreaterThan(check);
			expect(at(mdx, /^```/m, check), "a fence in Check it").toBeLessThan(seam);
			expect(
				at(mdx.slice(0, seam), /^## /m, check + 1),
				"no ## between Check it and Seam",
			).toBe(-1);
		});
	}

	test("the anatomy harness finds a page by its directory", () => {
		expect(ANATOMY_PAGES.every((p) => !p.includes("/"))).toBe(true);
	});
});
