import { describe, expect, test } from "bun:test";
import sitemap from "./sitemap";

const BASE = "https://www.secondlayer.tools";
const urls = sitemap().map((entry) => entry.url);

describe("sitemap", () => {
	test("lists every docs page on disk", () => {
		const docs = [
			...new Bun.Glob("src/app/(www)/docs/**/page.mdx").scanSync("."),
		].map(
			(file) =>
				`${BASE}/${file.replace("src/app/(www)/", "").replace(/\/?page\.mdx$/, "")}`,
		);
		expect(docs.length).toBeGreaterThan(0);
		for (const url of docs) expect(urls).toContain(url);
	});

	test("lists each url once", () => {
		expect(new Set(urls).size).toBe(urls.length);
	});

	test("keeps private routes out", () => {
		for (const url of urls)
			expect(url).not.toMatch(/\/(lab|account|signin|auth)\b/);
	});
});
