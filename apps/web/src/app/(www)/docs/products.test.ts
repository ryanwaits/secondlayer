import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCS_NAV } from "./nav";
import { DOCS_PRODUCTS, SEAM_CELLS } from "./products";

describe("docs products", () => {
	test("products are in the sidebar's chain-to-app order", () => {
		const group = DOCS_NAV.find((g) => g.label === "Products");
		expect(DOCS_PRODUCTS.map((p) => p.title)).toEqual(
			group?.items.map((i) => i.title) ?? [],
		);
	});

	test("every neighbour pair has seam text", () => {
		const expected: string[] = [];
		for (let i = 0; i < DOCS_PRODUCTS.length - 1; i++) {
			const a = DOCS_PRODUCTS[i]?.key;
			const b = DOCS_PRODUCTS[i + 1]?.key;
			expected.push(`${a}>${b}`, `${b}>${a}`);
		}
		expect(Object.keys(SEAM_CELLS).sort()).toEqual(expected.sort());
	});

	test("each seam tease starts with code that is on the neighbour's page", () => {
		for (const [pair, cell] of Object.entries(SEAM_CELLS)) {
			const to = pair.split(">")[1] as string;
			const lead = cell.tease.split(/\(| --/)[0] as string;
			const mdx = readFileSync(join(import.meta.dir, to, "page.mdx"), "utf8");
			expect(mdx, `${pair}: ${lead}`).toContain(lead);
		}
	});
});
