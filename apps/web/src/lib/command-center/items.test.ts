import { describe, expect, test } from "bun:test";
import apiNav from "@/generated/openapi-nav.json";
import { docsHeadingIndex } from "../docs-source";
import { DOCS_ITEMS, docsEndpointItems, docsHeadingItems } from "./items";
import { rankCommandItems } from "./search";

const titleFor = (href: string) =>
	DOCS_ITEMS.find((i) => i.href === href)?.label ?? href;

describe("docs search items", () => {
	test("heading items point at page#anchor and carry the page title", async () => {
		const items = docsHeadingItems(await docsHeadingIndex(), titleFor);
		const hit = items.find((i) => i.href?.startsWith("/docs/index#"));
		expect(hit).toBeDefined();
		expect(hit?.sub).toBe("Index");
		expect(items.every((i) => i.id === `docs:${i.href}`)).toBe(true);
	});

	test("endpoint items link into the reference with the endpoint sub", () => {
		const items = docsEndpointItems(apiNav);
		expect(items.length).toBeGreaterThan(0);
		for (const i of items) {
			expect(i.sub).toBe("endpoint");
			expect(i.href?.startsWith("/docs/api-reference#")).toBe(true);
		}
	});

	test("a reorg query ranks section hits and the pool spans several pages", async () => {
		const headings = docsHeadingItems(await docsHeadingIndex(), titleFor);
		const { flat } = rankCommandItems(
			"reorg",
			[...DOCS_ITEMS, ...headings, ...docsEndpointItems(apiNav)],
			new Map(),
		);
		expect(flat.length).toBeGreaterThan(0);
		const pages = new Set(
			headings
				.filter((h) => h.label.toLowerCase().includes("reorg"))
				.map((h) => h.href?.split("#")[0]),
		);
		expect(pages.size).toBeGreaterThanOrEqual(2);
	});
});
