import { describe, expect, test } from "bun:test";
import { anchorPages, pageContent } from "./page-content";
import { API_PAGES, familiesClaiming, pageForTag } from "./pages";
import { allEndpoints, objectsByTag } from "./spec";

describe("api reference pages", () => {
	test("every spec tag belongs to exactly one page", () => {
		const tags = new Set(allEndpoints().map((e) => e.tag));
		for (const tag of tags) {
			expect(
				API_PAGES.filter((p) => p.tags.includes(tag)).map((p) => p.slug),
				`tag ${tag}`,
			).toHaveLength(1);
		}
		for (const page of API_PAGES) {
			for (const tag of page.tags) expect(tags.has(tag), tag).toBe(true);
		}
	});

	test("every endpoint is claimed by exactly one family on its page", () => {
		for (const endpoint of allEndpoints()) {
			const page = pageForTag(endpoint.tag);
			expect(page, endpoint.anchor).toBeDefined();
			const claimed = familiesClaiming(
				page as NonNullable<typeof page>,
				endpoint.path,
			).map((f) => f.title);
			expect(claimed, `${endpoint.method} ${endpoint.path}`).toHaveLength(1);
		}
	});

	test("no endpoint falls into the Other family", () => {
		for (const page of API_PAGES) {
			const other = pageContent(page).families.find((f) => f.title === "Other");
			expect(other?.endpoints.map((e) => e.path) ?? []).toEqual([]);
		}
	});

	test("every page lists its endpoints once, and the counts match the plan", () => {
		const counts: Record<string, number> = {};
		const seen = new Set<string>();
		for (const page of API_PAGES) {
			const { families } = pageContent(page);
			counts[page.slug] = families.reduce((n, f) => n + f.endpoints.length, 0);
			for (const endpoint of families.flatMap((f) => f.endpoints)) {
				expect(seen.has(endpoint.anchor), endpoint.anchor).toBe(false);
				seen.add(endpoint.anchor);
			}
		}
		expect(seen.size).toBe(allEndpoints().length);
		expect(counts).toEqual({
			index: 29,
			streams: 6,
			proofs: 9,
			subgraphs: 24,
			webhooks: 24,
			instance: 8,
		});
	});

	test("every family on a page has endpoints and a unique heading id", () => {
		for (const page of API_PAGES) {
			const { families } = pageContent(page);
			expect(families).toHaveLength(page.families.length);
			const ids = families.map((f) => f.id);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});

	test("every endpoint and object anchor resolves to a page", () => {
		const owners = anchorPages();
		for (const endpoint of allEndpoints()) {
			expect(owners[endpoint.anchor], endpoint.anchor).toBeDefined();
		}
		for (const entries of objectsByTag().values()) {
			for (const entry of entries) {
				expect(owners[entry.anchor], entry.anchor).toBeDefined();
			}
		}
	});
});
