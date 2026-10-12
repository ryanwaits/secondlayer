import { describe, expect, mock, test } from "bun:test";
import { PRODUCTS } from "@/lib/site";
import { renderToStaticMarkup } from "react-dom/server";
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

// CodeBlock is an async server component; renderToStaticMarkup needs a sync stub.
mock.module("@/components/code-block", () => ({
	CodeBlock: ({ code }: { code: string }) => <pre data-codeblock>{code}</pre>,
}));

const pages = {
	index: (await import("./p/index/page")).default,
	streams: (await import("./p/streams/page")).default,
	subgraphs: (await import("./p/subgraphs/page")).default,
	webhooks: (await import("./p/webhooks/page")).default,
	archive: (await import("./p/archive/page")).default,
} as const;

const SLUGS = Object.keys(pages) as (keyof typeof pages)[];

function render(slug: keyof typeof pages): string {
	const Page = pages[slug];
	return renderToStaticMarkup(<Page />);
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

	test("code snippets render through CodeBlock, shell transcripts do not", () => {
		const count = (html: string) => html.match(/data-codeblock/g)?.length ?? 0;
		expect(count(render("index"))).toBe(0);
		expect(count(render("archive"))).toBe(0);
		expect(count(render("streams"))).toBeGreaterThanOrEqual(1);
		expect(count(render("subgraphs"))).toBeGreaterThanOrEqual(2);
		expect(count(render("webhooks"))).toBeGreaterThanOrEqual(2);
	});

	test("webhooks page trigger count matches the chain trigger schema", () => {
		expect(render("webhooks")).toContain(
			`${CHAIN_TRIGGER_TYPES.length} triggers`,
		);
	});
});
