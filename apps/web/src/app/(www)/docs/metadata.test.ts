import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const pages = [...new Bun.Glob("src/app/(www)/docs/**/page.mdx").scanSync(".")];

function metadataBlock(file: string): string {
	const source = readFileSync(file, "utf8");
	const start = source.indexOf("export const metadata");
	return start === -1 ? "" : source.slice(start);
}

describe("docs page metadata", () => {
	test("finds the docs pages", () => {
		expect(pages.length).toBeGreaterThan(0);
	});

	for (const file of pages) {
		const route = `/${file.replace("src/app/(www)/", "").replace(/\/?page\.mdx$/, "")}`;

		test(`${route} declares its own canonical`, () => {
			expect(metadataBlock(file)).toContain(`canonical: "${route}"`);
		});

		test(`${route} metadata has no em dash`, () => {
			const block = metadataBlock(file);
			expect(block).not.toBe("");
			expect(block).not.toContain("—");
		});
	}
});
