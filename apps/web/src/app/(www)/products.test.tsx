import { describe, expect, mock, test } from "bun:test";
import { PRODUCTS } from "@/lib/site";
import { renderAsync } from "@/lib/test-render";
import type { ReactNode } from "react";
import { CHAIN_TRIGGER_TYPES } from "../../../../../packages/shared/src/schemas/webhooks";

// bun's mock.module is process-wide, so stub every export the app imports.
mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const pages = {
	index: (await import("./p/index/page")).default,
	streams: (await import("./p/streams/page")).default,
	subgraphs: (await import("./p/subgraphs/page")).default,
	webhooks: (await import("./p/webhooks/page")).default,
	archive: (await import("./p/archive/page")).default,
} as const;

const SLUGS = Object.keys(pages) as (keyof typeof pages)[];

// Index, Streams and Archive are async (they read the signed manifest and the
// live event total). Render every page once with fetch offline, so they take
// the shipped fallback figures and the run never touches the network.
const realFetch = globalThis.fetch;
globalThis.fetch = (() =>
	Promise.reject(new Error("offline in tests"))) as unknown as typeof fetch;
const HTML = Object.fromEntries(
	await Promise.all(
		SLUGS.map(async (slug) => {
			const Page = pages[slug] as () => ReactNode | Promise<ReactNode>;
			return [slug, await renderAsync(await Page())] as const;
		}),
	),
) as Record<keyof typeof pages, string>;
globalThis.fetch = realFetch;

function render(slug: keyof typeof pages): string {
	return HTML[slug];
}

describe("product routes", () => {
	test("every product lives under /p so no route shadows the home page", () => {
		for (const product of PRODUCTS) {
			expect(product.href.startsWith("/p/")).toBe(true);
			expect(product.href).not.toBe("/index");
		}
	});
});

describe("product pages", () => {
	for (const slug of SLUGS) {
		const product = PRODUCTS.find((p) => p.href === `/p/${slug}`);

		test(`/${slug} has one h1, its eyebrow verb and a docs link`, () => {
			const html = render(slug);
			expect(html.match(/<h1>/g)).toHaveLength(1);
			expect(product).toBeDefined();
			expect(html).toContain(`${product?.noun}<span>· ${product?.verb}</span>`);
			expect(html).toContain(`href="/docs/${slug}"`);
		});

		test(`/${slug} ships no placeholder links, em dashes or old names`, () => {
			const html = render(slug);
			const hashLinks = html.match(/href="#[^"]*"/g) ?? [];
			for (const link of hashLinks) expect(link).toBe('href="#verify-cmd"');
			expect(html).not.toContain("—");
			expect(html).not.toContain("secondlayer-labs");
			expect(html).not.toContain("Subscriptions");
		});
	}

	test("/subgraphs offers no row webhooks", () => {
		expect(render("subgraphs").toLowerCase()).not.toContain("row webhook");
	});

	test("/webhooks says deliveries are signed", () => {
		expect(render("webhooks")).toContain("signed");
	});

	test("source files are figures with margin notes, shell transcripts are plain blocks", () => {
		const figures = (html: string) => html.match(/class="cf"/g)?.length ?? 0;
		expect(figures(render("index"))).toBeGreaterThanOrEqual(1);
		expect(figures(render("archive"))).toBe(0);
		expect(figures(render("streams"))).toBeGreaterThanOrEqual(1);
		expect(figures(render("subgraphs"))).toBeGreaterThanOrEqual(2);
		expect(figures(render("webhooks"))).toBeGreaterThanOrEqual(2);
	});

	test("product pages ship no terminal window chrome", () => {
		for (const slug of SLUGS) {
			expect(render(slug)).not.toContain("term-bar");
			expect(render(slug)).not.toContain("t-hit");
		}
	});

	test("webhooks page trigger count matches the chain trigger schema", () => {
		expect(render("webhooks")).toContain(
			`${CHAIN_TRIGGER_TYPES.length} triggers`,
		);
	});
});
